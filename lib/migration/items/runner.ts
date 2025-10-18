/**
 * Item migration background job runner
 * Executes item migration jobs asynchronously with progress tracking
 */

import { migrationStateStore } from '../state-store';
import { ItemMigrator } from './item-migrator';
import { updateMigrationProgress } from './service';
import { logger } from '../logging';
import {
  registerActiveMigration,
  unregisterActiveMigration,
  registerShutdownCallback,
  isPauseRequested,
} from '../shutdown-handler';
import { ThroughputCalculator } from './throughput-calculator';

/**
 * Run an item migration job in the background
 * Updates job status and progress throughout execution
 */
export async function runItemMigrationJob(jobId: string): Promise<void> {
  logger.info('Starting item migration job execution', { jobId });

  // Register migration as active
  registerActiveMigration(jobId);

  // Flag to track if migration should pause
  let shouldPause = false;

  // Register shutdown callback
  registerShutdownCallback(jobId, async () => {
    logger.info('Shutdown callback triggered', { jobId });
    shouldPause = true;
    // The migration loop will check shouldPause and complete current batch
  });

  try {
    // Get job details
    const job = await migrationStateStore.getMigrationJob(jobId);
    if (!job) {
      throw new Error(`Job not found: ${jobId}`);
    }

    const metadata = job.metadata as any;

    // LOG: Job metadata extracted
    console.log('🚀 Runner - Job metadata:', {
      jobId,
      sourceAppId: metadata.sourceAppId,
      targetAppId: metadata.targetAppId,
      mode: metadata.mode,
      sourceMatchField: metadata.sourceMatchField,
      targetMatchField: metadata.targetMatchField,
      duplicateBehavior: metadata.duplicateBehavior,
    });

    // Extract failed item IDs for retry (if this is a retry)
    const failedItems = job.progress?.failedItems || [];
    const retryItemIds = failedItems
      .map(item => item.sourceItemId)
      .filter(id => id > 0); // Filter out invalid IDs (e.g., 0 from update failures)

    if (retryItemIds.length > 0) {
      logger.info('Retry mode detected - will process only failed items', {
        jobId,
        failedItemCount: retryItemIds.length,
      });
    }

    // Update status to in_progress
    await migrationStateStore.updateJobStatus(jobId, 'in_progress');

    // Create migrator instance
    const migrator = new ItemMigrator();

    // Create throughput calculator
    const throughputCalculator = new ThroughputCalculator();

    // Track progress
    let lastProgressUpdate = Date.now();
    let lastProcessedCount = 0;
    let batchNumber = 0;
    let batchStartTime = Date.now();
    const PROGRESS_UPDATE_INTERVAL = 2000; // Update every 2 seconds

    // Execute migration with progress callback
    const result = await migrator.executeMigration({
      sourceAppId: metadata.sourceAppId,
      targetAppId: metadata.targetAppId,
      fieldMapping: metadata.fieldMapping,
      mode: metadata.mode || 'create',
      sourceMatchField: metadata.sourceMatchField,
      targetMatchField: metadata.targetMatchField,
      duplicateBehavior: metadata.duplicateBehavior || 'skip',
      batchSize: metadata.batchSize || 500,
      concurrency: metadata.concurrency || 5,
      stopOnError: metadata.stopOnError || false,
      filters: metadata.filters,
      resumeToken: metadata.resumeToken,
      maxItems: metadata.maxItems,
      retryItemIds: retryItemIds.length > 0 ? retryItemIds : undefined,
      onProgress: async (progress) => {
        // Check for pause request
        if (isPauseRequested(jobId)) {
          shouldPause = true;
        }

        // Throttle progress updates
        const now = Date.now();
        if (now - lastProgressUpdate >= PROGRESS_UPDATE_INTERVAL) {
          // Track batch completion for throughput calculation
          const itemsInBatch = progress.processed - lastProcessedCount;

          if (itemsInBatch > 0) {
            // Complete the current batch
            throughputCalculator.completeBatch(
              batchNumber,
              batchStartTime,
              itemsInBatch,
              false, // TODO: Track rate limiting from batch processor
              0      // TODO: Track rate limit delay from batch processor
            );

            // Calculate current throughput metrics
            const throughputMetrics = throughputCalculator.calculateMetrics(
              progress.total,
              progress.processed
            );

            // Save throughput metrics to state
            await migrationStateStore.updateThroughputMetrics(jobId, throughputMetrics);

            // Start next batch
            batchNumber++;
            batchStartTime = now;
            lastProcessedCount = progress.processed;
          }

          // Get current job state to preserve failedItems
          const currentJob = await migrationStateStore.getMigrationJob(jobId);
          const existingFailedItems = currentJob?.progress?.failedItems || [];

          await updateMigrationProgress(jobId, {
            total: progress.total,
            processed: progress.processed,
            successful: progress.successful,
            failed: progress.failed,
            percent: progress.total > 0 ? Math.round((progress.processed / progress.total) * 100) : 0,
            lastUpdate: new Date(),
            failedItems: existingFailedItems, // Preserve existing failed items
          });
          lastProgressUpdate = now;
        }

        // Signal migrator to pause if requested
        if (shouldPause) {
          throw new PauseRequested();
        }
      },
    });

    // Final progress update with throughput metrics
    const finalThroughputMetrics = throughputCalculator.calculateMetrics(
      result.processed,
      result.processed
    );
    await migrationStateStore.updateThroughputMetrics(jobId, finalThroughputMetrics);

    // Get current job state to preserve failedItems for final update
    const finalJob = await migrationStateStore.getMigrationJob(jobId);
    const finalFailedItems = finalJob?.progress?.failedItems || [];

    await updateMigrationProgress(jobId, {
      total: result.processed,
      processed: result.processed,
      successful: result.successful,
      failed: result.failed,
      percent: 100,
      lastUpdate: new Date(),
      failedItems: finalFailedItems, // Preserve all collected failed items
    });

    // Check if paused
    if (shouldPause) {
      await migrationStateStore.updateJobStatus(jobId, 'paused', new Date());
      logger.info('Item migration job paused', { jobId });
    } else {
      // Update status to completed
      await migrationStateStore.updateJobStatus(jobId, 'completed', new Date());

      logger.info('Item migration job completed successfully', {
        jobId,
        processed: result.processed,
        successful: result.successful,
        failed: result.failed,
      });
    }
  } catch (error) {
    // Check if this was a pause request
    if (error instanceof PauseRequested) {
      await migrationStateStore.updateJobStatus(jobId, 'paused', new Date());
      logger.info('Item migration job paused gracefully', { jobId });
      return; // Don't throw - this is a successful pause
    }

    logger.error('Item migration job failed', { jobId, error });

    // Update status to failed
    await migrationStateStore.updateJobStatus(jobId, 'failed', new Date());

    // Add error to job
    await migrationStateStore.addMigrationError(
      jobId,
      'migration_execution',
      error instanceof Error ? error.message : String(error),
      'EXECUTION_ERROR'
    );

    throw error;
  } finally {
    // Always unregister migration when done
    unregisterActiveMigration(jobId);
  }
}

/**
 * Custom error to signal pause request
 */
class PauseRequested extends Error {
  constructor() {
    super('Migration pause requested');
    this.name = 'PauseRequested';
  }
}

/**
 * Start an item migration job in the background (non-blocking)
 * Used for starting new migrations or resuming paused ones
 */
export function startItemMigrationJob(config: any): Promise<string> {
  // This will be the entry point called by the resume API
  // For now, return jobId placeholder - will be implemented when integrating with actual migration
  return Promise.resolve('jobId-placeholder');
}
