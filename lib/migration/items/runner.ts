/**
 * Item migration background job runner
 * Executes item migration jobs asynchronously with progress tracking
 */

import { migrationStateStore } from '../state-store';
import { ItemMigrator } from './item-migrator';
import { updateMigrationProgress } from './service';
import { logger } from '../logging';
import { convertFilters } from './filter-converter';
import {
  registerActiveMigration,
  unregisterActiveMigration,
  registerShutdownCallback,
  isPauseRequested,
} from '../shutdown-handler';
import { ThroughputCalculator } from './throughput-calculator';
import { MemoryMonitor, logMemoryStats, forceGC } from '../memory-monitor';
import { updateJobHeartbeat, getHeartbeatInterval } from '../job-lifecycle';
import { failureLogger } from './failure-logger';
import { getAppStructureCache } from './app-structure-cache';

/**
 * Run an item migration job in the background
 * Updates job status and progress throughout execution
 */
export async function runItemMigrationJob(jobId: string): Promise<void> {
  logger.info('Starting item migration job execution', { jobId });

  // Log initial memory usage
  logMemoryStats('migration_start');

  // Start memory monitoring
  const memoryMonitor = new MemoryMonitor({
    warningThreshold: 75,   // Warn at 75% heap usage
    criticalThreshold: 85,  // Critical at 85% heap usage
    checkInterval: 30000,   // Check every 30 seconds
    autoGC: true,          // Auto-trigger GC when critical
  });
  memoryMonitor.start(`migration:${jobId}`);

  // Register migration as active
  registerActiveMigration(jobId);

  // Flag to track if migration should pause
  let shouldPause = false;

  // Background heartbeat interval to ensure liveness even during long silent phases
  let heartbeatTimer: NodeJS.Timeout | undefined;

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
    logger.debug('Runner - Job metadata', {
      jobId,
      sourceAppId: metadata.sourceAppId,
      targetAppId: metadata.targetAppId,
      mode: metadata.mode,
      sourceMatchField: metadata.sourceMatchField,
      targetMatchField: metadata.targetMatchField,
      duplicateBehavior: metadata.duplicateBehavior,
    });

    // Extract failed item IDs for retry (if this is a retry)
    // Load lightweight list from the failures log
    const retryItemIds = (await failureLogger.getFailedItemIds(jobId))
      .filter(id => id > 0);

    if (retryItemIds.length > 0) {
      logger.info('Retry mode detected - will process only failed items', {
        jobId,
        failedItemCount: retryItemIds.length,
      });

      // Clear app structure cache to ensure fresh field data for retry
      // This is important when field mappings have been updated between retries
      const cache = getAppStructureCache();
      cache.clearAppStructure(metadata.sourceAppId);
      cache.clearAppStructure(metadata.targetAppId);
      logger.info('Cleared app structure cache for retry', {
        jobId,
        sourceAppId: metadata.sourceAppId,
        targetAppId: metadata.targetAppId,
      });

      // Save snapshot of current progress before clearing for retry
      // This preserves the pre-retry state for display in the dashboard
      logger.info('Saving pre-retry snapshot', { jobId });
      if (job.progress) {
        job.progress.preRetrySnapshot = {
          total: job.progress.total,
          processed: job.progress.processed,
          successful: job.progress.successful,
          failed: job.progress.failed,
          percent: job.progress.percent,
          lastUpdate: job.progress.lastUpdate,
        };
      }

      // Clear the failures log file and reset counters before starting retry
      // New failures will be added via incrementFailedItemCount() + failureLogger during this retry attempt
      logger.info('Clearing failures log and resetting counters for retry', { jobId });
      await failureLogger.clearFailedItems(jobId);

      if (job.progress) {
        job.progress.failed = 0; // Reset failed counter
        job.progress.processed = 0; // Reset processed counter for fresh retry stats
        job.progress.successful = 0; // Reset successful counter for fresh retry stats

        // Reset failedItemsByCategory counters
        if (job.progress.failedItemsByCategory) {
          job.progress.failedItemsByCategory = {
            network: 0,
            validation: 0,
            permission: 0,
            rate_limit: 0,
            duplicate: 0,
            unknown: 0,
          };
        }

        await migrationStateStore.saveMigrationJob(job);
      }
    }

    // Update status to in_progress
    await migrationStateStore.updateJobStatus(jobId, 'in_progress');

    // Seed initial heartbeat to prevent false "stale" classification before first progress event
    await updateJobHeartbeat(jobId);

    // Start background heartbeat interval to ensure liveness during long silent phases
    const hbIntervalMs = getHeartbeatInterval();
    heartbeatTimer = setInterval(() => {
      void updateJobHeartbeat(jobId);
    }, hbIntervalMs);

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

    // Convert user-friendly filters to Podio API format
    const podioFilters = convertFilters(metadata.filters);
    if (Object.keys(podioFilters).length > 0) {
      logger.info('Applying migration filters', {
        jobId,
        originalFilters: metadata.filters,
        convertedFilters: podioFilters,
      });
    }

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
      filters: podioFilters,
      resumeToken: metadata.resumeToken,
      maxItems: metadata.maxItems,
      dryRun: metadata.dryRun, // Pass dry-run mode
      transferFiles: metadata.transferFiles, // Pass file transfer mode
      retryItemIds: retryItemIds.length > 0 ? retryItemIds : undefined,
      onProgress: async (progress) => {
        // Check for pause request
        if (isPauseRequested(jobId)) {
          shouldPause = true;
        }

        const now = Date.now();

        // Throttle progress updates (heartbeat is handled by background interval)
        if (now - lastProgressUpdate >= PROGRESS_UPDATE_INTERVAL) {
          // Track batch completion for throughput calculation
          const itemsInBatch = progress.processed - lastProcessedCount;

          if (itemsInBatch > 0) {
            // Complete the current batch (rate limiting is tracked via callbacks below)
            throughputCalculator.completeBatch(
              batchNumber,
              batchStartTime,
              itemsInBatch,
              false, // Rate limiting tracked separately via onRateLimitPause/Resume
              0      // Rate limit delay tracked separately via onRateLimitPause/Resume
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

          await updateMigrationProgress(jobId, {
            total: progress.total,
            processed: progress.processed,
            successful: progress.successful,
            failed: progress.failed,
            percent: progress.total > 0 ? Math.round((progress.processed / progress.total) * 100) : 0,
            lastUpdate: new Date(),
          });
          lastProgressUpdate = now;
        }

        // Signal migrator to pause if requested
        if (shouldPause) {
          throw new PauseRequested();
        }
      },
      onRateLimitPause: async (info) => {
        logger.info('Rate limit pause started', {
          jobId,
          remaining: info.remaining,
          limit: info.limit,
          resumeAt: info.resumeAt.toISOString(),
          pauseStartTime: info.pauseStartTime.toISOString(),
        });
      },
      onRateLimitResume: async (info) => {
        // Record the pause in throughput calculator
        throughputCalculator.recordRateLimitPause(info.pauseDurationMs);

        // Get summary stats for logging
        const stats = throughputCalculator.getSummaryStats();

        logger.info('Rate limit pause ended - tracking recorded', {
          jobId,
          pauseDurationMs: info.pauseDurationMs,
          totalPauses: stats.totalRateLimitPauses,
          totalDelayMs: stats.totalRateLimitDelay,
        });

        // Update throughput metrics to reflect the pause
        const throughputMetrics = throughputCalculator.calculateMetrics(
          result.processed,
          result.processed
        );
        await migrationStateStore.updateThroughputMetrics(jobId, throughputMetrics);
      },
    });

    // Final progress update with throughput metrics
    const finalThroughputMetrics = throughputCalculator.calculateMetrics(
      result.processed,
      result.processed
    );
    await migrationStateStore.updateThroughputMetrics(jobId, finalThroughputMetrics);

    await updateMigrationProgress(jobId, {
      total: result.processed,
      processed: result.processed,
      successful: result.successful,
      failed: result.failed,
      percent: 100,
      lastUpdate: new Date(),
    });

    // Store dry-run preview in metadata if available
    if (result.dryRunPreview) {
      logger.info('Storing dry-run preview in job metadata', {
        jobId,
        wouldUpdate: result.dryRunPreview.summary.wouldUpdateCount,
        wouldFail: result.dryRunPreview.summary.wouldFailCount,
        wouldSkip: result.dryRunPreview.summary.wouldSkipCount,
      });

      const currentJob = await migrationStateStore.getMigrationJob(jobId);
      if (currentJob) {
        currentJob.metadata = {
          ...currentJob.metadata,
          dryRunPreview: result.dryRunPreview,
        };
        await migrationStateStore.saveMigrationJob(currentJob);
      }
    }

    // Check if cancelled by user
    if (shouldPause) {
      await migrationStateStore.updateJobStatus(jobId, 'cancelled', new Date());
      logger.info('Item migration job cancelled by user', { jobId });
    } else {
      // Update status to completed
      await migrationStateStore.updateJobStatus(jobId, 'completed', new Date());

      logger.info('Item migration job completed successfully', {
        jobId,
        processed: result.processed,
        successful: result.successful,
        failed: result.failed,
        dryRun: !!result.dryRunPreview,
      });
    }
  } catch (error) {
    // Check if this was a cancellation request
    if (error instanceof PauseRequested) {
      await migrationStateStore.updateJobStatus(jobId, 'cancelled', new Date());
      logger.info('Item migration job cancelled gracefully', { jobId });
      return; // Don't throw - this is a successful cancellation
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
    // Clear background heartbeat interval
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
    }

    // Stop memory monitoring
    memoryMonitor.stop();

    // Log final memory usage and trigger GC
    logMemoryStats('migration_end');
    forceGC();

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
