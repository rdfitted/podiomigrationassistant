/**
 * Custom error types for Podio API integration
 */

/**
 * Base error for Podio API failures
 */
export class PodioApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly errorCode?: string,
    public readonly errorDetail?: string,
    public readonly response?: unknown
  ) {
    super(message);
    this.name = 'PodioApiError';
    Object.setPrototypeOf(this, PodioApiError.prototype);
  }

  /**
   * Check if error is a client error (4xx)
   */
  isClientError(): boolean {
    return this.statusCode !== undefined && this.statusCode >= 400 && this.statusCode < 500;
  }

  /**
   * Check if error is a server error (5xx)
   */
  isServerError(): boolean {
    return this.statusCode !== undefined && this.statusCode >= 500;
  }

  /**
   * Check if error is unauthorized (401)
   */
  isUnauthorized(): boolean {
    return this.statusCode === 401;
  }

  /**
   * Check if error is rate limited (420 or 429)
   * Podio uses 420 for rate limit errors (not the standard 429)
   */
  isRateLimited(): boolean {
    return this.statusCode === 420 || this.statusCode === 429;
  }

  /**
   * Get human-readable error message
   */
  toHumanReadable(): string {
    const parts = [this.message];

    if (this.errorCode) {
      parts.push(`Error code: ${this.errorCode}`);
    }

    if (this.errorDetail) {
      parts.push(`Details: ${this.errorDetail}`);
    }

    if (this.statusCode) {
      parts.push(`Status: ${this.statusCode}`);
    }

    return parts.join(' | ');
  }
}

/**
 * Error for authentication/authorization failures
 */
export class PodioAuthError extends Error {
  constructor(
    message: string,
    public readonly errorCode?: string,
    public readonly errorDescription?: string
  ) {
    super(message);
    this.name = 'PodioAuthError';
    Object.setPrototypeOf(this, PodioAuthError.prototype);
  }

  /**
   * Get human-readable error message
   */
  toHumanReadable(): string {
    const parts = [this.message];

    if (this.errorDescription) {
      parts.push(this.errorDescription);
    }

    if (this.errorCode) {
      parts.push(`(${this.errorCode})`);
    }

    return parts.join(' - ');
  }
}

/**
 * Error for configuration issues
 */
export class PodioConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PodioConfigError';
    Object.setPrototypeOf(this, PodioConfigError.prototype);
  }
}

/**
 * Check if an error is transient and should be retried
 */
export function isTransientError(error: unknown): boolean {
  if (error instanceof PodioApiError) {
    // Retry on:
    // - 429 (rate limit)
    // - 500+ (server errors)
    // - Network errors (no status code)
    return (
      error.isRateLimited() ||
      error.isServerError() ||
      error.statusCode === undefined
    );
  }

  // Network errors from fetch
  if (error instanceof TypeError && error.message.includes('fetch')) {
    return true;
  }

  return false;
}

/**
 * Extract retry-after value from error (in seconds)
 */
export function getRetryAfter(error: PodioApiError): number | null {
  if (!error.response || typeof error.response !== 'object') {
    return null;
  }

  // Check for retry-after header in response
  const response = error.response as { headers?: Record<string, string> };
  const retryAfter = response.headers?.['retry-after'];

  if (retryAfter) {
    const seconds = parseInt(retryAfter, 10);
    return isNaN(seconds) ? null : seconds;
  }

  return null;
}

/**
 * Extract wait time from rate limit error message
 * Podio rate limit errors contain "Please wait X seconds before trying again"
 *
 * @param error - Podio API error
 * @returns Wait time in seconds, or null if not found
 */
export function getRateLimitWaitTime(error: PodioApiError): number | null {
  if (!error.isRateLimited()) {
    return null;
  }

  // Try to parse wait time from error message
  // Format: "Please wait 3600 seconds before trying again"
  const waitTimeMatch = error.message.match(/wait\s+(\d+)\s+seconds/i);

  if (waitTimeMatch && waitTimeMatch[1]) {
    const seconds = parseInt(waitTimeMatch[1], 10);
    if (!isNaN(seconds) && seconds > 0) {
      return seconds;
    }
  }

  // Default fallback: 1 hour (Podio's typical rate limit window)
  return 3600;
}

/**
 * Check if an error indicates a field not found (deleted field)
 * This suggests stale cache that should be cleared
 */
export function isFieldNotFoundError(error: unknown): boolean {
  if (error instanceof PodioApiError) {
    // Check for field-related error codes and messages
    const errorCode = error.errorCode?.toLowerCase() || '';
    const errorMessage = error.message?.toLowerCase() || '';
    const errorDetail = error.errorDetail?.toLowerCase() || '';

    return (
      errorCode.includes('invalid_field') ||
      errorCode.includes('field_not_found') ||
      errorMessage.includes('field') && errorMessage.includes('not found') ||
      errorMessage.includes('invalid field') ||
      errorDetail.includes('field') && errorDetail.includes('deleted') ||
      (error.statusCode === 400 && errorMessage.includes('field'))
    );
  }

  return false;
}
