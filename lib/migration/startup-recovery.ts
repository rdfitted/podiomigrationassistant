/**
 * Startup Recovery
 * Automatically cleanup stale jobs when the server starts
 */

import { cleanupStaleJobs, findStaleJobs } from './job-lifecycle';
import { logger } from './logging';

/**
 * Run startup recovery process
 * Call this once when the server starts
 */
export async function runStartupRecovery(): Promise<void> {
  try {
    logger.info('Running startup recovery - checking for stale jobs');

    // Find stale jobs first
    const staleJobs = await findStaleJobs();

    if (staleJobs.length === 0) {
      logger.info('Startup recovery: No stale jobs found');
      return;
    }

    logger.warn('Startup recovery: Found stale jobs from previous server session', {
      count: staleJobs.length,
      jobIds: staleJobs.map(j => j.id),
    });

    // Cleanup stale jobs
    const cleanedCount = await cleanupStaleJobs();

    logger.info('Startup recovery complete', {
      staleJobsFound: staleJobs.length,
      jobsCleaned: cleanedCount,
    });
  } catch (error) {
    logger.error('Startup recovery failed', { error });
    // Don't throw - startup recovery failure shouldn't prevent server from starting
  }
}
