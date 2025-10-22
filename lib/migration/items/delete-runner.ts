/**
 * Delete job background runner
 * Executes delete jobs asynchronously with progress tracking
 */

import { executeDeleteJob } from './delete-service';
import { logger } from '../logging';
import {
  registerActiveMigration,
  unregisterActiveMigration,
  registerShutdownCallback,
} from '../shutdown-handler';

/**
 * Run a delete job in the background
 * Updates job status and progress throughout execution
 */
export async function runDeleteJob(jobId: string): Promise<void> {
  logger.info('Starting delete job execution', { jobId });

  // Register as active migration (for shutdown handling)
  registerActiveMigration(jobId);

  // Flag to track if job should pause
  let shouldPause = false;

  // Register shutdown callback
  registerShutdownCallback(jobId, async () => {
    logger.info('Shutdown callback triggered for delete job', { jobId });
    shouldPause = true;
  });

  try {
    // Execute the delete job
    await executeDeleteJob(jobId);

    logger.info('Delete job execution completed', { jobId });
  } catch (error) {
    logger.error('Delete job execution failed', {
      jobId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    // Unregister migration
    unregisterActiveMigration(jobId);
  }
}
