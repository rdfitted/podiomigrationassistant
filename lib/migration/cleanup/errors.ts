/**
 * Custom error classes for cleanup operations
 */

/**
 * Error thrown when a cleanup job is not found
 */
export class CleanupJobNotFoundError extends Error {
  constructor(jobId: string) {
    super(`Cleanup job not found: ${jobId}`);
    this.name = 'CleanupJobNotFoundError';
  }
}

/**
 * Error thrown when cleanup validation fails
 */
export class CleanupValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CleanupValidationError';
  }
}
