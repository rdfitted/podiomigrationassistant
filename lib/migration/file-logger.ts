/**
 * File-Based Logger for Migration System
 *
 * Provides structured JSON logging to multiple log streams with automatic
 * rotation, buffering, and graceful shutdown support.
 */

import { promises as fs } from 'fs';
import { createWriteStream, WriteStream } from 'fs';
import {
  LogConfig,
  LogLevel,
  MigrationLogPaths,
  DEFAULT_LOG_CONFIG,
  getMigrationLogPaths,
  ensureLogDirectory,
  shouldLog,
  formatLogLevel,
  getTimestamp,
  needsRotation,
  rotateLogFile,
  cleanupOldLogs,
} from './log-config';

export type LogStream = 'migration' | 'items' | 'batches' | 'errors';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  migrationId: string;
  message: string;
  data?: Record<string, any>;
  batchNumber?: number;
  itemId?: number;
  sourceItemId?: number;
  operation?: string;
  duration?: number;
  error?: string;
}

/**
 * File-based logger with structured JSON output and automatic rotation
 */
export class MigrationFileLogger {
  private migrationId: string;
  private paths: MigrationLogPaths;
  private config: LogConfig;
  private streams: Map<LogStream, WriteStream>;
  private writeQueues: Map<LogStream, string[]>;
  private isShuttingDown: boolean;
  private flushTimers: Map<string, NodeJS.Timeout>;

  constructor(migrationId: string, config: LogConfig = DEFAULT_LOG_CONFIG) {
    this.migrationId = migrationId;
    this.paths = getMigrationLogPaths(migrationId);
    this.config = config;
    this.streams = new Map();
    this.writeQueues = new Map();
    this.isShuttingDown = false;
    this.flushTimers = new Map();
  }

  /**
   * Initialize the logger (create directories and streams)
   */
  async initialize(): Promise<void> {
    await ensureLogDirectory(this.paths.migrationDir);

    // Initialize write queues
    this.writeQueues.set('migration', []);
    this.writeQueues.set('items', []);
    this.writeQueues.set('batches', []);
    this.writeQueues.set('errors', []);

    // Create write streams
    await this.createStream('migration', this.paths.migrationLog);
    await this.createStream('items', this.paths.itemsLog);
    await this.createStream('batches', this.paths.batchesLog);
    await this.createStream('errors', this.paths.errorsLog);

    // Start periodic flush (every 1 second)
    this.startPeriodicFlush();

    // Cleanup old logs
    await cleanupOldLogs(this.paths.migrationDir, this.config.maxAge);
  }

  /**
   * Create a write stream for a specific log type
   */
  private async createStream(streamType: LogStream, filePath: string): Promise<void> {
    // Check if rotation needed
    if (await needsRotation(filePath, this.config.maxFileSize)) {
      await rotateLogFile(filePath);
    }

    const stream = createWriteStream(filePath, { flags: 'a', encoding: 'utf8' });
    this.streams.set(streamType, stream);

    // Handle stream errors
    stream.on('error', (error) => {
      console.error(`Error writing to ${streamType} log:`, error);
    });
  }

  /**
   * Start periodic flush timer
   */
  private startPeriodicFlush(): void {
    const flushInterval = setInterval(() => {
      if (!this.isShuttingDown) {
        this.flushAll();
      }
    }, 1000); // Flush every 1 second

    // Store for cleanup
    this.flushTimers.set('periodic', flushInterval);
  }

  /**
   * Log to migration.log (main events)
   */
  async logMigration(level: LogLevel, message: string, data?: Record<string, any>): Promise<void> {
    await this.log('migration', level, message, data);
  }

  /**
   * Log to items.log (per-item tracking)
   */
  async logItem(
    level: LogLevel,
    message: string,
    sourceItemId: number,
    targetItemId?: number,
    data?: Record<string, any>
  ): Promise<void> {
    await this.log('items', level, message, {
      ...data,
      sourceItemId,
      itemId: targetItemId,
    });
  }

  /**
   * Log to batches.log (batch-level progress)
   */
  async logBatch(
    level: LogLevel,
    message: string,
    batchNumber: number,
    data?: Record<string, any>
  ): Promise<void> {
    await this.log('batches', level, message, { ...data, batchNumber });
  }

  /**
   * Log to errors.log (detailed error traces)
   */
  async logError(
    message: string,
    error: Error | string,
    data?: Record<string, any>
  ): Promise<void> {
    const errorMessage = error instanceof Error ? error.message : error;
    const errorStack = error instanceof Error ? error.stack : undefined;

    await this.log('errors', 'ERROR', message, {
      ...data,
      error: errorMessage,
      stack: errorStack,
    });
  }

  /**
   * Core logging method
   */
  private async log(
    stream: LogStream,
    level: LogLevel,
    message: string,
    data?: Record<string, any>
  ): Promise<void> {
    // Check log level threshold
    if (!shouldLog(level, this.config)) {
      return;
    }

    const entry: LogEntry = {
      timestamp: getTimestamp(),
      level,
      migrationId: this.migrationId,
      message,
      ...data,
    };

    const line = JSON.stringify(entry) + '\n';

    // Add to write queue
    const queue = this.writeQueues.get(stream);
    if (queue) {
      queue.push(line);
    }

    // Also log to console if enabled
    if (this.config.consoleEnabled) {
      const levelStr = formatLogLevel(level);
      console.log(`[${entry.timestamp}] [${levelStr}] [${stream}] ${message}`);
      if (data && Object.keys(data).length > 0) {
        console.log('  Data:', JSON.stringify(data, null, 2));
      }
    }

    // Flush errors immediately
    if (level === 'ERROR') {
      await this.flush(stream);
    }
  }

  /**
   * Flush a specific stream's write queue
   */
  private async flush(stream: LogStream): Promise<void> {
    const queue = this.writeQueues.get(stream);
    const writeStream = this.streams.get(stream);

    if (!queue || !writeStream || queue.length === 0) {
      return;
    }

    // Write all queued entries
    const data = queue.join('');
    queue.length = 0; // Clear queue

    return new Promise((resolve, reject) => {
      writeStream.write(data, (error) => {
        if (error) {
          console.error(`Failed to flush ${stream} log:`, error);
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Flush all streams
   */
  private async flushAll(): Promise<void> {
    const promises: Promise<void>[] = [];

    for (const stream of ['migration', 'items', 'batches', 'errors'] as LogStream[]) {
      promises.push(this.flush(stream));
    }

    await Promise.all(promises);
  }

  /**
   * Gracefully shutdown the logger (flush all buffers and close streams)
   */
  async shutdown(): Promise<void> {
    this.isShuttingDown = true;

    // Stop periodic flush
    for (const timer of this.flushTimers.values()) {
      clearInterval(timer);
    }
    this.flushTimers.clear();

    // Flush all remaining data
    await this.flushAll();

    // Close all streams
    const closePromises: Promise<void>[] = [];
    for (const [streamType, stream] of this.streams.entries()) {
      closePromises.push(
        new Promise((resolve) => {
          stream.end(() => {
            resolve();
          });
        })
      );
    }

    await Promise.all(closePromises);
    this.streams.clear();
  }

  /**
   * Get log file paths for this migration
   */
  getLogPaths(): MigrationLogPaths {
    return this.paths;
  }
}

/**
 * Logger registry for managing multiple migration loggers
 */
class LoggerRegistry {
  private loggers: Map<string, MigrationFileLogger>;

  constructor() {
    this.loggers = new Map();
  }

  /**
   * Get or create a logger for a migration
   */
  async getLogger(migrationId: string): Promise<MigrationFileLogger> {
    let logger = this.loggers.get(migrationId);

    if (!logger) {
      logger = new MigrationFileLogger(migrationId);
      await logger.initialize();
      this.loggers.set(migrationId, logger);
    }

    return logger;
  }

  /**
   * Remove a logger (after migration completes)
   */
  async removeLogger(migrationId: string): Promise<void> {
    const logger = this.loggers.get(migrationId);
    if (logger) {
      await logger.shutdown();
      this.loggers.delete(migrationId);
    }
  }

  /**
   * Shutdown all loggers (graceful shutdown)
   */
  async shutdownAll(): Promise<void> {
    const promises: Promise<void>[] = [];

    for (const [migrationId, logger] of this.loggers.entries()) {
      promises.push(logger.shutdown());
    }

    await Promise.all(promises);
    this.loggers.clear();
  }

  /**
   * Get all active migration IDs
   */
  getActiveMigrations(): string[] {
    return Array.from(this.loggers.keys());
  }
}

// Global logger registry
const loggerRegistry = new LoggerRegistry();

/**
 * Get a logger for a specific migration
 */
export async function getMigrationLogger(migrationId: string): Promise<MigrationFileLogger> {
  return loggerRegistry.getLogger(migrationId);
}

/**
 * Remove a logger after migration completes
 */
export async function removeMigrationLogger(migrationId: string): Promise<void> {
  return loggerRegistry.removeLogger(migrationId);
}

/**
 * Shutdown all active loggers (call during process shutdown)
 */
export async function shutdownAllLoggers(): Promise<void> {
  return loggerRegistry.shutdownAll();
}

/**
 * Get all active migration IDs with loggers
 */
export function getActiveLoggers(): string[] {
  return loggerRegistry.getActiveMigrations();
}
