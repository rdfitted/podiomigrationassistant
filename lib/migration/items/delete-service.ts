/**
 * Delete service for batch item deletion with progress tracking
 * Provides phase-based progress (detecting → deleting → completed)
 */

import { migrationStateStore } from '../state-store';
import { getPodioHttpClient } from '../../podio/http/client';
import { streamItems, fetchItemCount, bulkDeleteItems } from '../../podio/resources/items';
import { logger } from '../logging';
import {
  DeleteJobRequestPayload,
  DeleteJobStatusResponse,
  DeleteJobMetadata,
  DeletePhase,
  ItemMigrationFilters,
} from './types';

/**
 * Create a new delete job
 */
export async function createDeleteJob(
  request: DeleteJobRequestPayload
): Promise<{ jobId: string }> {
  logger.info('Creating delete job', {
    appId: request.appId,
    filters: request.filters,
    maxItems: request.maxItems,
    dryRun: request.dryRun,
  });

  // Create job in state store
  const job = await migrationStateStore.createMigrationJob(
    String(request.appId), // Using appId as sourceSpaceId
    String(request.appId), // Using appId as targetSpaceId (same for delete)
    {
      jobType: 'item_delete',
      appId: request.appId,
      filters: request.filters,
      maxItems: request.maxItems,
      concurrency: request.concurrency || 5,
      stopOnError: request.stopOnError || false,
      dryRun: request.dryRun || false,
      phase: 'detecting' as DeletePhase,
      phaseProgress: {
        detecting: {
          fetched: 0,
          estimatedTotal: 0,
          percent: 0,
        },
      },
    } as DeleteJobMetadata
  );

  logger.info('Delete job created', { jobId: job.id });

  return { jobId: job.id };
}

/**
 * Get delete job status
 */
export async function getDeleteJob(
  jobId: string
): Promise<DeleteJobStatusResponse | null> {
  const job = await migrationStateStore.getMigrationJob(jobId);
  if (!job) {
    return null;
  }

  const metadata = job.metadata as DeleteJobMetadata;

  // Calculate error statistics by category
  const errorsByCategory: Record<string, { count: number; percentage: number; shouldRetry: boolean }> = {};
  const failedItems = job.progress?.failedItems || [];

  if (failedItems.length > 0) {
    const categoryCounts = new Map<string, number>();
    for (const item of failedItems) {
      const category = item.errorCategory;
      categoryCounts.set(category, (categoryCounts.get(category) || 0) + 1);
    }

    const total = failedItems.length;
    for (const [category, count] of categoryCounts.entries()) {
      errorsByCategory[category] = {
        count,
        percentage: Math.round((count / total) * 100),
        shouldRetry: category === 'network' || category === 'rate_limit' || category === 'unknown',
      };
    }
  }

  // Generate phase status message
  let phaseStatus = '';
  switch (metadata.phase) {
    case 'detecting':
      phaseStatus = 'Detecting items to delete...';
      break;
    case 'deleting':
      phaseStatus = 'Deleting items...';
      break;
    case 'completed':
      phaseStatus = 'Deletion completed';
      break;
    case 'failed':
      phaseStatus = 'Deletion failed';
      break;
  }

  return {
    jobId: job.id,
    status: job.status,
    phase: metadata.phase,
    progress: job.progress
      ? {
          total: job.progress.total,
          processed: job.progress.processed,
          successful: job.progress.successful,
          failed: job.progress.failed,
          percent: job.progress.percent,
          lastUpdate: job.progress.lastUpdate.toISOString(),
        }
      : {
          total: 0,
          processed: 0,
          successful: 0,
          failed: 0,
          percent: 0,
          lastUpdate: new Date().toISOString(),
        },
    phaseStatus,
    phaseProgress: metadata.phaseProgress,
    throughput: job.progress?.throughput
      ? {
          itemsPerSecond: job.progress.throughput.itemsPerSecond,
          batchesPerMinute: job.progress.throughput.batchesPerMinute,
          avgBatchDuration: job.progress.throughput.avgBatchDuration,
          estimatedCompletionTime: job.progress.throughput.estimatedCompletionTime?.toISOString(),
          rateLimitPauses: job.progress.throughput.rateLimitPauses,
          totalRateLimitDelay: job.progress.throughput.totalRateLimitDelay,
        }
      : undefined,
    errors: job.errors.map((err) => ({
      itemId: (err as any).itemId,
      message: err.message,
      code: err.code,
      timestamp: err.timestamp.toISOString(),
    })),
    errorsByCategory: Object.keys(errorsByCategory).length > 0 ? errorsByCategory : undefined,
    startedAt: typeof job.startedAt === 'string' ? job.startedAt : job.startedAt.toISOString(),
    completedAt: job.completedAt
      ? typeof job.completedAt === 'string'
        ? job.completedAt
        : job.completedAt.toISOString()
      : undefined,
    failedItems: failedItems.map((item) => ({
      itemId: item.sourceItemId, // Using sourceItemId as itemId for deletes
      error: item.error,
      timestamp:
        typeof item.lastAttemptAt === 'string'
          ? item.lastAttemptAt
          : item.lastAttemptAt.toISOString(),
    })),
  };
}

/**
 * Execute delete job with phase-based progress tracking
 */
export async function executeDeleteJob(jobId: string): Promise<void> {
  logger.info('Starting delete job execution', { jobId });

  const job = await migrationStateStore.getMigrationJob(jobId);
  if (!job) {
    throw new Error(`Delete job not found: ${jobId}`);
  }

  const metadata = job.metadata as DeleteJobMetadata;
  const client = getPodioHttpClient();

  try {
    // Update job status to in_progress
    await migrationStateStore.updateJobStatus(jobId, 'in_progress');

    // PHASE 1: DETECTING - Fetch items to delete
    logger.info('Phase 1: Detecting items to delete', { jobId, appId: metadata.appId });
    await updateDeletePhase(jobId, 'detecting', 'Detecting items to delete...');

    // First, get total count for progress tracking
    const { total: estimatedTotal } = await fetchItemCount(
      client,
      metadata.appId,
      metadata.filters
    );

    logger.info('Estimated items to delete', { jobId, estimatedTotal });

    // Update detecting phase progress
    await updateDetectingProgress(jobId, 0, estimatedTotal);

    // Stream items and collect IDs
    const itemIds: number[] = [];
    const maxItems = metadata.maxItems || Infinity;

    for await (const batch of streamItems(client, metadata.appId, {
      batchSize: 500,
      filters: metadata.filters,
    })) {
      // Collect item IDs
      for (const item of batch) {
        if (itemIds.length >= maxItems) {
          break;
        }
        itemIds.push(item.item_id);
      }

      // Update detecting progress
      await updateDetectingProgress(jobId, itemIds.length, estimatedTotal);

      logger.info('Detecting progress', {
        jobId,
        fetched: itemIds.length,
        estimatedTotal,
      });

      if (itemIds.length >= maxItems) {
        break;
      }
    }

    logger.info('Detection phase complete', {
      jobId,
      totalItems: itemIds.length,
    });

    // Save item IDs to metadata
    metadata.itemIds = itemIds;
    await migrationStateStore.updateJobMetadata(jobId, metadata);

    // If dry run, stop here
    if (metadata.dryRun) {
      logger.info('Dry run mode - skipping deletion phase', { jobId });
      await updateDeletePhase(jobId, 'completed', 'Dry run completed');
      await migrationStateStore.updateJobStatus(jobId, 'completed', new Date());
      await migrationStateStore.updateJobProgress(jobId, {
        total: itemIds.length,
        processed: itemIds.length,
        successful: itemIds.length,
        failed: 0,
        percent: 100,
        lastUpdate: new Date(),
      });
      return;
    }

    // PHASE 2: DELETING - Delete items with progress tracking
    logger.info('Phase 2: Deleting items', { jobId, total: itemIds.length });
    await updateDeletePhase(jobId, 'deleting', 'Deleting items...');

    // Initialize deleting phase progress
    await updateDeletingProgress(jobId, itemIds.length, 0, 0, 0);

    // Delete items in batches with granular progress tracking
    const concurrency = metadata.concurrency || 5;
    let successful = 0;
    let failed = 0;
    const failedItems: Array<{ itemId: number; error: string; index: number }> = [];

    for (let i = 0; i < itemIds.length; i += concurrency) {
      const batch = itemIds.slice(i, i + concurrency);

      // Delete batch
      const batchResult = await bulkDeleteItems(client, batch, {
        concurrency,
        stopOnError: metadata.stopOnError || false,
      });

      successful += batchResult.successCount;
      failed += batchResult.failureCount;
      failedItems.push(...batchResult.failed);

      // Update progress after each batch
      const processed = successful + failed;
      await updateDeletingProgress(jobId, itemIds.length, processed, successful, failed);

      logger.info('Deletion batch progress', {
        jobId,
        processed,
        total: itemIds.length,
        successful,
        failed,
        percent: Math.round((processed / itemIds.length) * 100),
      });

      // Check if should stop on error
      if (metadata.stopOnError && batchResult.failureCount > 0) {
        logger.warn('Stopping deletion due to error', { jobId });
        break;
      }
    }

    const deleteResult = {
      successful: itemIds.filter((id) => !failedItems.find((f) => f.itemId === id)),
      failed: failedItems,
      successCount: successful,
      failureCount: failed,
    };

    // Track failed items
    for (const failedItem of deleteResult.failed) {
      await migrationStateStore.addFailedItem(jobId, {
        sourceItemId: failedItem.itemId,
        error: failedItem.error,
        errorCategory: 'unknown',
        attemptCount: 1,
        firstAttemptAt: new Date(),
        lastAttemptAt: new Date(),
      });
    }

    // Update final progress
    await migrationStateStore.updateJobProgress(jobId, {
      total: itemIds.length,
      processed: deleteResult.successCount + deleteResult.failureCount,
      successful: deleteResult.successCount,
      failed: deleteResult.failureCount,
      percent: 100,
      lastUpdate: new Date(),
    });

    logger.info('Deletion phase complete', {
      jobId,
      total: itemIds.length,
      successful: deleteResult.successCount,
      failed: deleteResult.failureCount,
    });

    // Update to completed phase
    await updateDeletePhase(jobId, 'completed', 'Deletion completed');
    await migrationStateStore.updateJobStatus(jobId, 'completed', new Date());
  } catch (error) {
    logger.error('Delete job execution failed', {
      jobId,
      error: error instanceof Error ? error.message : String(error),
    });

    await updateDeletePhase(jobId, 'failed', 'Deletion failed');
    await migrationStateStore.updateJobStatus(jobId, 'failed');
    await migrationStateStore.addMigrationError(
      jobId,
      'delete_execution',
      error instanceof Error ? error.message : String(error)
    );

    throw error;
  }
}

/**
 * Update delete job phase
 */
async function updateDeletePhase(
  jobId: string,
  phase: DeletePhase,
  phaseStatus: string
): Promise<void> {
  const job = await migrationStateStore.getMigrationJob(jobId);
  if (!job) {
    throw new Error(`Delete job not found: ${jobId}`);
  }

  const metadata = job.metadata as DeleteJobMetadata;
  metadata.phase = phase;

  await migrationStateStore.updateJobMetadata(jobId, metadata);

  logger.info('Delete phase updated', { jobId, phase, phaseStatus });
}

/**
 * Update detecting phase progress
 */
async function updateDetectingProgress(
  jobId: string,
  fetched: number,
  estimatedTotal: number
): Promise<void> {
  const job = await migrationStateStore.getMigrationJob(jobId);
  if (!job) {
    throw new Error(`Delete job not found: ${jobId}`);
  }

  const metadata = job.metadata as DeleteJobMetadata;
  if (!metadata.phaseProgress) {
    metadata.phaseProgress = {};
  }

  metadata.phaseProgress.detecting = {
    fetched,
    estimatedTotal,
    percent: estimatedTotal > 0 ? Math.round((fetched / estimatedTotal) * 100) : 0,
  };

  await migrationStateStore.updateJobMetadata(jobId, metadata);

  // Also update overall progress
  await migrationStateStore.updateJobProgress(jobId, {
    total: estimatedTotal,
    processed: fetched,
    successful: 0,
    failed: 0,
    percent: estimatedTotal > 0 ? Math.round((fetched / estimatedTotal) * 100) : 0,
    lastUpdate: new Date(),
  });
}

/**
 * Update deleting phase progress
 */
async function updateDeletingProgress(
  jobId: string,
  total: number,
  processed: number,
  successful: number,
  failed: number
): Promise<void> {
  const job = await migrationStateStore.getMigrationJob(jobId);
  if (!job) {
    throw new Error(`Delete job not found: ${jobId}`);
  }

  const metadata = job.metadata as DeleteJobMetadata;
  if (!metadata.phaseProgress) {
    metadata.phaseProgress = {};
  }

  metadata.phaseProgress.deleting = {
    total,
    processed,
    successful,
    failed,
    percent: total > 0 ? Math.round((processed / total) * 100) : 0,
  };

  await migrationStateStore.updateJobMetadata(jobId, metadata);

  // Also update overall progress
  await migrationStateStore.updateJobProgress(jobId, {
    total,
    processed,
    successful,
    failed,
    percent: total > 0 ? Math.round((processed / total) * 100) : 0,
    lastUpdate: new Date(),
  });
}
