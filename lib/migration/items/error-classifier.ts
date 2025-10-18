/**
 * Error Classification for Migration Failures
 *
 * Categorizes errors to enable intelligent retry logic:
 * - network: Temporary connectivity issues (SHOULD RETRY)
 * - rate_limit: API rate limiting (SHOULD RETRY with backoff)
 * - validation: Data validation errors (SHOULD NOT RETRY without fix)
 * - permission: Authorization/permission errors (SHOULD NOT RETRY)
 * - duplicate: Duplicate key violations (SHOULD NOT RETRY)
 * - unknown: Unclassified errors (RETRY with caution)
 */

import { ErrorCategory } from '../state-store';
import { PodioApiError } from '../../podio/errors';

export interface ClassifiedError {
  category: ErrorCategory;
  message: string;
  shouldRetry: boolean;
  retryDelay?: number; // Suggested delay in milliseconds
  code?: string;
  details?: Record<string, unknown>;
}

/**
 * Classify an error for intelligent retry logic
 */
export function classifyError(error: unknown): ClassifiedError {
  // Handle PodioApiError (from Podio SDK)
  if (error instanceof PodioApiError) {
    const statusCode = error.statusCode;
    const errorCode = error.errorCode;
    const errorDetail = error.errorDetail;

    if (statusCode) {
      // Rate limiting (429)
      if (statusCode === 429) {
        return {
          category: 'rate_limit',
          message: 'API rate limit exceeded',
          shouldRetry: true,
          retryDelay: 5000, // Wait 5 seconds
          code: 'RATE_LIMIT_EXCEEDED',
          details: { statusCode, errorCode, errorDetail },
        };
      }

      // Network errors (5xx)
      if (statusCode >= 500 && statusCode < 600) {
        return {
          category: 'network',
          message: `Server error: ${statusCode}`,
          shouldRetry: true,
          retryDelay: 2000, // Wait 2 seconds
          code: 'SERVER_ERROR',
          details: { statusCode, errorCode, errorDetail },
        };
      }

      // Permission errors (401, 403)
      if (statusCode === 401 || statusCode === 403) {
        return {
          category: 'permission',
          message: 'Permission denied',
          shouldRetry: false,
          code: 'PERMISSION_DENIED',
          details: { statusCode, errorCode, errorDetail },
        };
      }

      // Validation errors (400)
      if (statusCode === 400) {
        // Check for duplicate key errors
        const isDuplicate =
          errorCode === 'duplicate' ||
          (errorDetail &&
           (errorDetail.toLowerCase().includes('duplicate') ||
            errorDetail.toLowerCase().includes('already exists')));

        if (isDuplicate) {
          return {
            category: 'duplicate',
            message: 'Duplicate item detected',
            shouldRetry: false,
            code: 'DUPLICATE_ITEM',
            details: { statusCode, errorCode, errorDetail },
          };
        }

        // Other validation errors
        return {
          category: 'validation',
          message: errorDetail || 'Invalid data',
          shouldRetry: false,
          code: 'VALIDATION_ERROR',
          details: { statusCode, errorCode, errorDetail },
        };
      }

      // Not found errors (404)
      if (statusCode === 404) {
        return {
          category: 'validation',
          message: 'Resource not found',
          shouldRetry: false,
          code: 'NOT_FOUND',
          details: { statusCode, errorCode, errorDetail },
        };
      }
    }
  }

  // Handle generic Error objects
  if (error instanceof Error) {
    const message = error.message.toLowerCase();

    // Network errors
    if (
      message.includes('network') ||
      message.includes('timeout') ||
      message.includes('econnrefused') ||
      message.includes('econnreset') ||
      message.includes('fetch failed')
    ) {
      return {
        category: 'network',
        message: error.message,
        shouldRetry: true,
        retryDelay: 2000,
        code: 'NETWORK_ERROR',
      };
    }

    // Rate limit
    if (message.includes('rate limit') || message.includes('too many requests')) {
      return {
        category: 'rate_limit',
        message: error.message,
        shouldRetry: true,
        retryDelay: 5000,
        code: 'RATE_LIMIT',
      };
    }

    // Duplicate
    if (message.includes('duplicate') || message.includes('already exists')) {
      return {
        category: 'duplicate',
        message: error.message,
        shouldRetry: false,
        code: 'DUPLICATE',
      };
    }

    // Validation
    if (
      message.includes('invalid') ||
      message.includes('required') ||
      message.includes('validation')
    ) {
      return {
        category: 'validation',
        message: error.message,
        shouldRetry: false,
        code: 'VALIDATION_ERROR',
      };
    }

    // Permission
    if (
      message.includes('permission') ||
      message.includes('unauthorized') ||
      message.includes('forbidden')
    ) {
      return {
        category: 'permission',
        message: error.message,
        shouldRetry: false,
        code: 'PERMISSION_ERROR',
      };
    }
  }

  // Unknown error
  const errorMessage = error instanceof Error ? error.message : String(error);
  return {
    category: 'unknown',
    message: errorMessage,
    shouldRetry: true, // Retry unknown errors, but with caution
    retryDelay: 1000,
    code: 'UNKNOWN_ERROR',
  };
}

/**
 * Calculate retry delay with exponential backoff
 *
 * @param attemptNumber - Current attempt number (0-indexed)
 * @param baseDelay - Base delay in milliseconds (default: 1000)
 * @param maxDelay - Maximum delay in milliseconds (default: 30000)
 * @returns Delay in milliseconds with jitter
 */
export function calculateRetryDelay(
  attemptNumber: number,
  baseDelay: number = 1000,
  maxDelay: number = 30000
): number {
  // Exponential backoff: baseDelay * 2^attemptNumber
  const exponentialDelay = baseDelay * Math.pow(2, attemptNumber);

  // Cap at maxDelay
  const cappedDelay = Math.min(exponentialDelay, maxDelay);

  // Add jitter (±20%) to prevent thundering herd
  const jitter = cappedDelay * 0.2 * (Math.random() * 2 - 1);
  const finalDelay = Math.round(cappedDelay + jitter);

  return Math.max(finalDelay, 0);
}

/**
 * Determine if an error should be retried based on category and attempt count
 *
 * @param category - Error category
 * @param attemptCount - Number of previous attempts
 * @param maxRetries - Maximum number of retries allowed (default: 3)
 * @returns True if should retry, false otherwise
 */
export function shouldRetryError(
  category: ErrorCategory,
  attemptCount: number,
  maxRetries: number = 3
): boolean {
  // Never retry these categories
  if (category === 'validation' || category === 'permission' || category === 'duplicate') {
    return false;
  }

  // Check attempt limit
  if (attemptCount >= maxRetries) {
    return false;
  }

  // Retry network and rate_limit errors
  if (category === 'network' || category === 'rate_limit') {
    return true;
  }

  // Retry unknown errors (but only once)
  if (category === 'unknown' && attemptCount < 1) {
    return true;
  }

  return false;
}

/**
 * Get human-readable error category name
 */
export function getErrorCategoryLabel(category: ErrorCategory): string {
  const labels: Record<ErrorCategory, string> = {
    network: 'Network Error',
    rate_limit: 'Rate Limit',
    validation: 'Validation Error',
    permission: 'Permission Denied',
    duplicate: 'Duplicate Item',
    unknown: 'Unknown Error',
  };

  return labels[category] || 'Unknown Error';
}
