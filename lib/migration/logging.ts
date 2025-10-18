/**
 * Migration logging utilities
 * Structured logging for migration events and progress tracking with file-based persistence
 */

import { getMigrationLogger, MigrationFileLogger } from './file-logger';
import { LogLevel as FileLogLevel } from './log-config';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface MigrationLogEntry {
  timestamp: string;
  level: LogLevel;
  migrationId: string;
  event: string;
  data?: Record<string, unknown>;
  duration?: number;
}

interface OperationMetrics {
  startTime: number;
  operation: string;
  migrationId: string;
}

// In-memory metrics store (could be persisted or sent to telemetry service)
const operationMetrics = new Map<string, OperationMetrics>();

// Cache for migration loggers
const loggerCache = new Map<string, Promise<MigrationFileLogger>>();

/**
 * Get or create a file logger for a migration
 */
async function getLogger(migrationId: string): Promise<MigrationFileLogger> {
  if (!loggerCache.has(migrationId)) {
    loggerCache.set(migrationId, getMigrationLogger(migrationId));
  }
  return loggerCache.get(migrationId)!;
}

/**
 * Convert log level to file logger format
 */
function toFileLogLevel(level: LogLevel): FileLogLevel {
  return level.toUpperCase() as FileLogLevel;
}

/**
 * Log a migration event with structured data
 */
export async function logMigrationEvent(
  migrationId: string,
  event: string,
  data?: Record<string, unknown>,
  level: LogLevel = 'info'
): Promise<void> {
  const entry: MigrationLogEntry = {
    timestamp: new Date().toISOString(),
    level,
    migrationId,
    event,
    data,
  };

  try {
    const logger = await getLogger(migrationId);
    await logger.logMigration(toFileLogLevel(level), event, data as Record<string, any>);
  } catch (error) {
    // Fallback to console if file logging fails
    const logFn = getLogFunction(level);
    const formattedData = data ? JSON.stringify(data, null, 2) : '';
    logFn(`[Migration ${migrationId}] ${event}`, formattedData);
  }

  // Could emit to telemetry service here
  emitTelemetry(entry);
}

/**
 * Log tool call with arguments and results
 */
export async function logToolCall(
  migrationId: string,
  toolName: string,
  args: Record<string, unknown>,
  result?: unknown,
  error?: Error
): Promise<void> {
  const data: Record<string, unknown> = {
    toolName,
    arguments: args,
  };

  if (result !== undefined) {
    data.result = result;
  }

  if (error) {
    data.error = {
      message: error.message,
      name: error.name,
      stack: error.stack,
    };
  }

  await logMigrationEvent(
    migrationId,
    error ? 'tool_call_failed' : 'tool_call_success',
    data,
    error ? 'error' : 'debug'
  );
}

/**
 * Track timing metrics for operations
 */
export function startOperationTimer(migrationId: string, operation: string): string {
  const timerId = `${migrationId}:${operation}:${Date.now()}`;
  operationMetrics.set(timerId, {
    startTime: Date.now(),
    operation,
    migrationId,
  });
  return timerId;
}

/**
 * End operation timer and log duration
 */
export function endOperationTimer(timerId: string, success: boolean = true): number {
  const metrics = operationMetrics.get(timerId);
  if (!metrics) {
    console.warn(`Operation timer not found: ${timerId}`);
    return 0;
  }

  const duration = Date.now() - metrics.startTime;
  operationMetrics.delete(timerId);

  // Fire and forget - don't await to avoid blocking
  logMigrationEvent(
    metrics.migrationId,
    `${metrics.operation}_${success ? 'completed' : 'failed'}`,
    { duration_ms: duration },
    success ? 'info' : 'error'
  ).catch(console.error);

  return duration;
}

/**
 * Create a logging context for a migration operation with timing
 */
export function withMigrationContext<T>(
  migrationId: string,
  operation: string,
  fn: () => Promise<T>
): Promise<T> {
  const timerId = startOperationTimer(migrationId, operation);

  logMigrationEvent(migrationId, `${operation}_started`, undefined, 'debug');

  return fn()
    .then((result) => {
      const duration = endOperationTimer(timerId, true);
      logMigrationEvent(
        migrationId,
        `${operation}_completed`,
        { duration_ms: duration },
        'debug'
      );
      return result;
    })
    .catch((error) => {
      endOperationTimer(timerId, false);
      logMigrationEvent(
        migrationId,
        `${operation}_failed`,
        {
          error: error.message,
          errorName: error.name,
          errorStack: error.stack,
        },
        'error'
      );
      throw error;
    });
}

/**
 * Log progress updates with percentage
 */
export function logProgress(
  migrationId: string,
  completed: number,
  total: number,
  currentStep?: string
): void {
  const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;
  // Fire and forget - don't await to avoid blocking progress updates
  logMigrationEvent(
    migrationId,
    'migration_progress',
    {
      completed,
      total,
      percentage,
      currentStep,
    },
    'info'
  ).catch(console.error);
}

/**
 * Log duplicate detection events with trace IDs
 */
export function logDuplicateDetection(
  migrationId: string,
  traceId: string,
  event: 'duplicate_found' | 'duplicate_skipped' | 'duplicate_updated' | 'no_duplicate',
  data: {
    sourceItemId: number;
    matchField: string;
    matchValue: unknown;
    normalizedValue: string;
    targetItemId?: number;
    fromCache?: boolean;
  }
): void {
  // Fire and forget - don't await to avoid blocking
  logMigrationEvent(
    migrationId,
    `duplicate_detection_${event}`,
    {
      traceId,
      ...data,
    },
    event === 'duplicate_found' || event === 'duplicate_skipped' || event === 'duplicate_updated' ? 'info' : 'debug'
  ).catch(console.error);
}

/**
 * Categorize and log errors
 */
export function logErrorCategory(
  migrationId: string,
  errorCategory: 'network' | 'authentication' | 'validation' | 'permission' | 'unknown',
  error: Error,
  context?: Record<string, unknown>
): void {
  // Fire and forget - don't await to avoid blocking
  logMigrationEvent(
    migrationId,
    'error_categorized',
    {
      category: errorCategory,
      message: error.message,
      name: error.name,
      context,
    },
    'error'
  ).catch(console.error);
}

/**
 * Log item-level events (written to items.log)
 */
export async function logItemEvent(
  migrationId: string,
  message: string,
  level: LogLevel,
  sourceItemId: number,
  targetItemId?: number,
  data?: Record<string, unknown>
): Promise<void> {
  try {
    const logger = await getLogger(migrationId);
    await logger.logItem(toFileLogLevel(level), message, sourceItemId, targetItemId, data as Record<string, any>);
  } catch (error) {
    // Fallback to console
    console.error(`Failed to log item event for migration ${migrationId}:`, error);
  }
}

/**
 * Log batch-level events (written to batches.log)
 */
export async function logBatchEvent(
  migrationId: string,
  message: string,
  level: LogLevel,
  batchNumber: number,
  data?: Record<string, unknown>
): Promise<void> {
  try {
    const logger = await getLogger(migrationId);
    await logger.logBatch(toFileLogLevel(level), message, batchNumber, data as Record<string, any>);
  } catch (error) {
    // Fallback to console
    console.error(`Failed to log batch event for migration ${migrationId}:`, error);
  }
}

/**
 * Log error with full details (written to errors.log)
 */
export async function logErrorDetails(
  migrationId: string,
  message: string,
  error: Error | string,
  data?: Record<string, unknown>
): Promise<void> {
  try {
    const logger = await getLogger(migrationId);
    await logger.logError(message, error, data as Record<string, any>);
  } catch (err) {
    // Fallback to console
    console.error(`Failed to log error for migration ${migrationId}:`, err);
  }
}

/**
 * Emit telemetry (placeholder for external telemetry service)
 */
function emitTelemetry(entry: MigrationLogEntry): void {
  // In production, this could send to:
  // - Application Insights
  // - Datadog
  // - CloudWatch
  // - Custom telemetry endpoint
  // For now, this is a no-op
}

/**
 * Get console log function for level
 */
function getLogFunction(level: LogLevel): (...args: any[]) => void {
  switch (level) {
    case 'debug':
      return console.debug;
    case 'info':
      return console.info;
    case 'warn':
      return console.warn;
    case 'error':
      return console.error;
    default:
      return console.log;
  }
}

/**
 * Simple logger object for consistent logging interface (console fallback)
 * Use for logging outside of migration context
 */
export const logger = {
  info: (message: string, data?: Record<string, unknown>) => {
    const logFn = getLogFunction('info');
    logFn(message, data ? JSON.stringify(data) : '');
  },
  error: (message: string, data?: Record<string, unknown>) => {
    const logFn = getLogFunction('error');
    logFn(message, data ? JSON.stringify(data) : '');
  },
  warn: (message: string, data?: Record<string, unknown>) => {
    const logFn = getLogFunction('warn');
    logFn(message, data ? JSON.stringify(data) : '');
  },
  debug: (message: string, data?: Record<string, unknown>) => {
    const logFn = getLogFunction('debug');
    logFn(message, data ? JSON.stringify(data) : '');
  },
};

/**
 * Cleanup logger for a completed migration
 */
export async function cleanupMigrationLogger(migrationId: string): Promise<void> {
  loggerCache.delete(migrationId);
}
