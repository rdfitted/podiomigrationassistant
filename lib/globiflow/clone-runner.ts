/**
 * GlobiFlow Clone Job Runner
 * Orchestrates the execution of flow clone jobs
 */

import { migrationStateStore } from '@/lib/migration/state-store';
import { logger } from '@/lib/migration/logging';
import { executeFlowCloneStep, getFlowCloneJobStatus } from './service';
import { FlowCloneJob } from './types';

/**
 * Execute a flow clone job
 * Processes all steps in the job sequentially
 *
 * @param jobId - Job ID to execute
 */
export async function executeFlowCloneJob(jobId: string): Promise<void> {
  try {
    logger.info('Starting flow clone job execution', { jobId });

    // Get job details
    const job = await getFlowCloneJobStatus(jobId);
    if (!job) {
      throw new Error(`Flow clone job not found: ${jobId}`);
    }

    // Update job status to in_progress
    await migrationStateStore.updateJobStatus(jobId, 'in_progress');

    const { sourceAppId, targetAppId, continueOnError } = job;
    let hasErrors = false;

    // Execute each step
    for (const step of job.steps) {
      if (step.status !== 'pending') {
        logger.debug('Skipping step (already processed)', {
          jobId,
          stepId: step.id,
          status: step.status,
        });
        continue;
      }

      try {
        logger.info('Executing flow clone step', {
          jobId,
          stepId: step.id,
          sourceFlowId: step.sourceId,
        });

        // Execute the flow clone step with field remapping
        await executeFlowCloneStep(
          jobId,
          step.id,
          step.sourceId,
          sourceAppId,
          targetAppId,
          undefined // newName - will use default "(Copy)" suffix
        );

        logger.info('Flow clone step succeeded', {
          jobId,
          stepId: step.id,
        });
      } catch (error) {
        hasErrors = true;
        logger.error('Flow clone step failed', {
          jobId,
          stepId: step.id,
          error,
        });

        // If continueOnError is false, stop execution
        if (!continueOnError) {
          logger.warn('Stopping job execution due to error', { jobId });
          await migrationStateStore.updateJobStatus(jobId, 'failed', new Date());
          return;
        }

        // Otherwise, continue to next step
        logger.info('Continuing to next step despite error', { jobId });
      }
    }

    // Update final job status
    const finalStatus = hasErrors ? 'failed' : 'completed';
    await migrationStateStore.updateJobStatus(jobId, finalStatus, new Date());

    logger.info('Flow clone job execution completed', {
      jobId,
      status: finalStatus,
    });
  } catch (error) {
    logger.error('Flow clone job execution failed', { jobId, error });

    // Update job status to failed
    try {
      await migrationStateStore.updateJobStatus(jobId, 'failed', new Date());
      await migrationStateStore.addMigrationError(
        jobId,
        'job_execution',
        error instanceof Error ? error.message : 'Unknown error',
        'JOB_EXECUTION_ERROR'
      );
    } catch (updateError) {
      logger.error('Failed to update job status', { jobId, error: updateError });
    }

    throw error;
  }
}
