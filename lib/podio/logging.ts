/**
 * Structured logging utilities for Podio API operations
 * Server-side only - do not use in client components
 */

type LogLevel = 'info' | 'warn' | 'error' | 'debug';

interface LogContext {
  [key: string]: unknown;
}

/**
 * Structured logger for Podio operations
 * Outputs JSON-formatted logs for easier parsing and monitoring
 */
export function podioLog(
  level: LogLevel,
  message: string,
  context?: LogContext
): void {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    level,
    service: 'podio',
    message,
    ...context,
  };

  // Redact sensitive information
  const sanitized = redactSensitiveData(logEntry);

  // Output to appropriate console method
  switch (level) {
    case 'error':
      console.error(JSON.stringify(sanitized));
      break;
    case 'warn':
      console.warn(JSON.stringify(sanitized));
      break;
    case 'debug':
      if (process.env.NODE_ENV === 'development') {
        console.debug(JSON.stringify(sanitized));
      }
      break;
    default:
      console.log(JSON.stringify(sanitized));
  }
}

/**
 * Redact sensitive data from log entries
 */
function redactSensitiveData(data: Record<string, unknown>): Record<string, unknown> {
  const sensitiveKeys = [
    'password',
    'access_token',
    'refresh_token',
    'client_secret',
    'authorization',
  ];

  const redacted = { ...data };

  for (const key of Object.keys(redacted)) {
    const lowerKey = key.toLowerCase();
    if (sensitiveKeys.some(sensitive => lowerKey.includes(sensitive))) {
      redacted[key] = '[REDACTED]';
    }

    // Recursively redact nested objects
    if (typeof redacted[key] === 'object' && redacted[key] !== null) {
      redacted[key] = redactSensitiveData(redacted[key] as Record<string, unknown>);
    }
  }

  return redacted;
}

/**
 * Generate correlation ID for request tracking
 */
export function generateCorrelationId(): string {
  return `podio_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Log API request
 */
export function logApiRequest(
  method: string,
  url: string,
  correlationId: string
): void {
  podioLog('info', 'API request', {
    correlationId,
    method,
    url,
  });
}

/**
 * Log API response
 */
export function logApiResponse(
  method: string,
  url: string,
  statusCode: number,
  correlationId: string,
  durationMs: number,
  responseBody?: unknown
): void {
  podioLog('info', 'API response', {
    correlationId,
    method,
    url,
    statusCode,
    durationMs,
    responseBody,
  });
}

/**
 * Log API error
 */
export function logApiError(
  method: string,
  url: string,
  error: unknown,
  correlationId: string
): void {
  podioLog('error', 'API error', {
    correlationId,
    method,
    url,
    error: error instanceof Error ? error.message : String(error),
  });
}

/**
 * Log token refresh
 */
export function logTokenRefresh(success: boolean, reason?: string): void {
  podioLog(success ? 'info' : 'error', 'Token refresh', {
    success,
    reason,
  });
}

/**
 * Log rate limit
 */
export function logRateLimit(
  remaining: number,
  limit: number,
  resetAt?: string
): void {
  podioLog('warn', 'Rate limit warning', {
    remaining,
    limit,
    resetAt,
  });
}

/**
 * Simple logger object for consistent logging interface
 */
export const logger = {
  info: (message: string, context?: Record<string, unknown>) => {
    podioLog('info', message, context);
  },
  error: (message: string, context?: Record<string, unknown>) => {
    podioLog('error', message, context);
  },
  warn: (message: string, context?: Record<string, unknown>) => {
    podioLog('warn', message, context);
  },
  debug: (message: string, context?: Record<string, unknown>) => {
    podioLog('debug', message, context);
  },
};
