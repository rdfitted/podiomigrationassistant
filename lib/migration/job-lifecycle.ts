/**
 * Job Lifecycle Management
 * Provides heartbeat tracking and stale job cleanup
 */

import { migrationStateStore, MigrationJob, MigrationJobStatus } from './state-store';
import { logger } from './logging';

/**
 * Heartbeat configuration
 */
const HEARTBEAT_TIMEOUT_MS = 60000; // 60 seconds - job is stale if no heartbeat for this long
const HEARTBEAT_UPDATE_INTERVAL_MS = 10000; // 10 seconds - how often to update heartbeat

/**
 * Check if a job is currently active based on its in-memory state
 * A job is considered active if:
 * 1. It has status 'in_progress'
 * 2. It has a recent heartbeat (within HEARTBEAT_TIMEOUT_MS)
 */
function isJobActiveFrom(job: MigrationJob, now = Date.now()): boolean {
  // Only in_progress jobs can be active
  if (job.status !== 'in_progress') {
    return false;
  }

  // Check heartbeat
  if (!job.lastHeartbeat) {
    // No heartbeat yet - could be a job that just started
    // Check if it started recently (within last 60 seconds)
    const timeSinceStart = now - job.startedAt.getTime();
    return timeSinceStart < HEARTBEAT_TIMEOUT_MS;
  }

  // Check if heartbeat is recent
  const timeSinceHeartbeat = now - job.lastHeartbeat.getTime();
  return timeSinceHeartbeat < HEARTBEAT_TIMEOUT_MS;
}

/**
 * Check if a job is currently active based on its heartbeat
 * A job is considered active if:
 * 1. It has status 'in_progress'
 * 2. It has a recent heartbeat (within HEARTBEAT_TIMEOUT_MS)
 */
export async function isJobActive(jobId: string): Promise<boolean> {
  try {
    const job = await migrationStateStore.getMigrationJob(jobId);

    if (!job) {
      logger.debug('Job not found when checking if active', { jobId });
      return false;
    }

    const isActive = isJobActiveFrom(job);

    if (!isActive && job.status === 'in_progress') {
      if (!job.lastHeartbeat) {
        logger.debug('Job has no heartbeat and is not recently started', {
          jobId,
          startedAt: job.startedAt,
          timeSinceStart: Date.now() - job.startedAt.getTime(),
        });
      } else {
        logger.debug('Job heartbeat is stale', {
          jobId,
          lastHeartbeat: job.lastHeartbeat,
          timeSinceHeartbeat: Date.now() - job.lastHeartbeat.getTime(),
          timeoutMs: HEARTBEAT_TIMEOUT_MS,
        });
      }
    }

    return isActive;
  } catch (error) {
    logger.error('Error checking if job is active', { jobId, error });
    return false;
  }
}

/**
 * Update the heartbeat timestamp for a job
 * Should be called periodically by running migrations
 */
export async function updateJobHeartbeat(jobId: string): Promise<void> {
  try {
    const job = await migrationStateStore.getMigrationJob(jobId);

    if (!job) {
      logger.warn('Cannot update heartbeat: job not found', { jobId });
      return;
    }

    // Only update heartbeat for in_progress jobs
    if (job.status !== 'in_progress') {
      logger.debug('Skipping heartbeat update for non-running job', {
        jobId,
        status: job.status,
      });
      return;
    }

    job.lastHeartbeat = new Date();
    await migrationStateStore.saveMigrationJob(job);

    logger.debug('Updated job heartbeat', { jobId, lastHeartbeat: job.lastHeartbeat });
  } catch (error) {
    // Don't throw - heartbeat update failure shouldn't stop the migration
    logger.error('Failed to update job heartbeat', { jobId, error });
  }
}

/**
 * Find all stale jobs (in_progress but no recent heartbeat)
 */
export async function findStaleJobs(): Promise<MigrationJob[]> {
  try {
    const allJobs = await migrationStateStore.listMigrationJobs();
    const staleJobs: MigrationJob[] = [];
    const now = Date.now();

    for (const job of allJobs) {
      if (job.status === 'in_progress' && !isJobActiveFrom(job, now)) {
        staleJobs.push(job);
      }
    }

    return staleJobs;
  } catch (error) {
    logger.error('Error finding stale jobs', { error });
    return [];
  }
}

/**
 * Clean up stale jobs by marking them as failed
 * Returns the number of jobs cleaned up
 */
export async function cleanupStaleJobs(): Promise<number> {
  try {
    const staleJobs = await findStaleJobs();

    if (staleJobs.length === 0) {
      logger.info('No stale jobs found');
      return 0;
    }

    logger.warn('Found stale jobs to clean up', {
      count: staleJobs.length,
      jobIds: staleJobs.map(j => j.id),
    });

    let cleaned = 0;
    for (const job of staleJobs) {
      try {
        // Re-fetch and re-verify to avoid racing with a resumed runner
        const fresh = await migrationStateStore.getMigrationJob(job.id);
        if (!fresh || fresh.status !== 'in_progress') {
          logger.debug('Skip cleanup; job no longer in_progress', {
            jobId: job.id,
            status: fresh?.status,
          });
          continue;
        }

        // Re-evaluate staleness
        const now = Date.now();
        const stillInactive = !fresh.lastHeartbeat
          ? (now - fresh.startedAt.getTime()) >= HEARTBEAT_TIMEOUT_MS
          : (now - fresh.lastHeartbeat.getTime()) >= HEARTBEAT_TIMEOUT_MS;

        if (!stillInactive) {
          logger.debug('Skip cleanup; job became active', {
            jobId: fresh.id,
            lastHeartbeat: fresh.lastHeartbeat,
          });
          continue;
        }

        logger.info('Cleaning up stale job', {
          jobId: fresh.id,
          status: fresh.status,
          lastHeartbeat: fresh.lastHeartbeat,
          startedAt: fresh.startedAt,
        });

        // Mark as failed with explanatory error
        await migrationStateStore.updateJobStatus(fresh.id, 'failed', new Date());
        await migrationStateStore.addMigrationError(
          fresh.id,
          'job_lifecycle',
          'Job marked as failed due to missing heartbeat. The job appears to have been orphaned (server restart or crash).',
          'STALE_JOB_CLEANUP'
        );
        cleaned++;
      } catch (error) {
        logger.error('Failed to cleanup stale job', {
          jobId: job.id,
          error,
        });
        // Continue with other jobs - don't let one failure abort the cleanup
      }
    }

    logger.info('Stale job cleanup complete', {
      cleanedUp: cleaned,
      detected: staleJobs.length,
    });
    return cleaned;
  } catch (error) {
    logger.error('Error cleaning up stale jobs', { error });
    return 0;
  }
}

/**
 * Get the recommended heartbeat update interval
 */
export function getHeartbeatInterval(): number {
  return HEARTBEAT_UPDATE_INTERVAL_MS;
}

/**
 * Get job health status with detailed information
 */
export async function getJobHealth(jobId: string): Promise<{
  jobId: string;
  status: MigrationJobStatus | 'not_found';
  isActive: boolean;
  lastHeartbeat?: Date;
  timeSinceHeartbeat?: number;
  healthStatus: 'healthy' | 'stale' | 'not_running';
}> {
  const job = await migrationStateStore.getMigrationJob(jobId);

  if (!job) {
    return {
      jobId,
      status: 'not_found',
      isActive: false,
      healthStatus: 'not_running',
    };
  }

  const isActive = await isJobActive(jobId);
  const timeSinceHeartbeat = job.lastHeartbeat
    ? Date.now() - job.lastHeartbeat.getTime()
    : undefined;

  let healthStatus: 'healthy' | 'stale' | 'not_running';
  if (job.status !== 'in_progress') {
    healthStatus = 'not_running';
  } else if (isActive) {
    healthStatus = 'healthy';
  } else {
    healthStatus = 'stale';
  }

  return {
    jobId,
    status: job.status,
    isActive,
    lastHeartbeat: job.lastHeartbeat,
    timeSinceHeartbeat,
    healthStatus,
  };
}
