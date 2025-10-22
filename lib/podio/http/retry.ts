import { PodioApiError, isTransientError, getRetryAfter, getRateLimitWaitTime } from '../errors';
import { podioLog } from '../logging';
import { getRateLimitTracker } from './rate-limit-tracker';

/**
 * Retry policy configuration
 */
export interface RetryConfig {
  /** Maximum number of retry attempts (default: 4) */
  maxAttempts: number;
  /** Base delay in milliseconds (default: 500ms) */
  baseDelay: number;
  /** Maximum delay in milliseconds (default: 8000ms) */
  maxDelay: number;
  /** Whether to use full jitter (default: true) */
  useJitter: boolean;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 4,
  baseDelay: 500,
  maxDelay: 8000,
  useJitter: true,
};

/**
 * Calculate exponential backoff delay with optional jitter
 *
 * Formula: min(baseDelay * 2^attempt, maxDelay)
 * With jitter: random value between 0 and calculated delay
 *
 * @param attempt - Current attempt number (0-indexed)
 * @param config - Retry configuration
 * @returns Delay in milliseconds
 */
export function calculateBackoff(
  attempt: number,
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): number {
  const exponentialDelay = config.baseDelay * Math.pow(2, attempt);
  const cappedDelay = Math.min(exponentialDelay, config.maxDelay);

  if (config.useJitter) {
    // Full jitter: random value between 0 and cappedDelay
    return Math.random() * cappedDelay;
  }

  return cappedDelay;
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry wrapper for async operations with exponential backoff
 *
 * @param operation - Async operation to retry
 * @param config - Retry configuration
 * @param context - Context information for logging
 * @returns Result of the operation
 * @throws Last error if all retries are exhausted
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  config: RetryConfig = DEFAULT_RETRY_CONFIG,
  context?: { method?: string; url?: string }
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < config.maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      // Don't retry if this is the last attempt
      if (attempt === config.maxAttempts - 1) {
        break;
      }

      // Special handling for rate limit errors (420)
      if (error instanceof PodioApiError && error.isRateLimited()) {
        const tracker = getRateLimitTracker();

        // Try to get wait time from rate limit tracker first
        let timeUntilResetMs = tracker.getTimeUntilReset();

        // If tracker doesn't have a reset time, parse it from the error message
        if (timeUntilResetMs === 0) {
          const waitSeconds = getRateLimitWaitTime(error);
          if (waitSeconds !== null) {
            timeUntilResetMs = waitSeconds * 1000;

            // Update tracker with calculated reset time
            // Use existing limit if available, otherwise use placeholder
            // The actual limit will be updated from X-Rate-Limit headers on next successful request
            const currentLimit = tracker.getLimit();
            if (currentLimit !== null) {
              const resetTime = new Date(Date.now() + timeUntilResetMs).toISOString();
              tracker.updateFromHeaders(
                currentLimit,
                0, // Remaining is 0 when rate limited
                resetTime
              );
            }
          }
        }

        podioLog('warn', 'Rate limit hit (420) - waiting for reset', {
          attempt: attempt + 1,
          statusCode: error.statusCode,
          remaining: tracker.getRemainingQuota(),
          timeUntilResetMs,
          timeUntilResetSeconds: Math.round(timeUntilResetMs / 1000),
          timeUntilResetMin: Math.round(timeUntilResetMs / 60000),
          resumeAt: new Date(Date.now() + timeUntilResetMs).toISOString(),
          ...context,
        });

        // Wait for rate limit reset (max 1 hour)
        await tracker.waitForReset();

        podioLog('info', 'Rate limit reset complete - retrying request', {
          attempt: attempt + 1,
          ...context,
        });

        // Retry after waiting
        continue;
      }

      // Don't retry if error is not transient
      if (!isTransientError(error)) {
        podioLog('info', 'Non-transient error, not retrying', {
          attempt: attempt + 1,
          error: error instanceof Error ? error.message : String(error),
          ...context,
        });
        break;
      }

      // Calculate delay for other transient errors
      let delay: number;

      // Check if error provides a retry-after header
      if (error instanceof PodioApiError) {
        const retryAfter = getRetryAfter(error);
        if (retryAfter !== null) {
          delay = retryAfter * 1000; // Convert seconds to milliseconds
          podioLog('info', 'Using retry-after from response', {
            attempt: attempt + 1,
            retryAfterSeconds: retryAfter,
            ...context,
          });
        } else {
          delay = calculateBackoff(attempt, config);
        }
      } else {
        delay = calculateBackoff(attempt, config);
      }

      podioLog('warn', 'Retrying after error', {
        attempt: attempt + 1,
        maxAttempts: config.maxAttempts,
        delayMs: Math.round(delay),
        error: error instanceof Error ? error.message : String(error),
        ...context,
      });

      // Wait before retrying
      await sleep(delay);
    }
  }

  // All retries exhausted
  podioLog('error', 'All retry attempts exhausted', {
    maxAttempts: config.maxAttempts,
    error: lastError instanceof Error ? lastError.message : String(lastError),
    ...context,
  });

  throw lastError;
}

/**
 * Create a custom retry config
 */
export function createRetryConfig(
  overrides: Partial<RetryConfig>
): RetryConfig {
  return {
    ...DEFAULT_RETRY_CONFIG,
    ...overrides,
  };
}
