/**
 * Duplicate cleanup executor
 * Handles the actual deletion of duplicate items
 */

import { EventEmitter } from 'events';
import { PodioHttpClient } from '../../podio/http/client';
import { bulkDeleteItems } from '../../podio/resources/items';
import { logger } from '../logging';
import { migrationStateStore } from '../state-store';
import {
  CleanupRequestPayload,
  CleanupResult,
  CleanupDryRunPreview,
  DuplicateGroup,
  CleanupMode,
  KeepStrategy,
} from './types';
import { detectDuplicateGroups, applyKeepStrategy } from './service';

/**
 * Cleanup executor configuration
 */
export interface CleanupExecutorConfig {
  appId: number;
  matchField: string;
  mode: CleanupMode;
  keepStrategy: 'oldest' | 'newest'; // Normalized - 'manual' is handled at request level
  batchSize: number;
  concurrency: number;
  dryRun: boolean;
  maxGroups?: number;
  approvedGroups?: DuplicateGroup[];
}

/**
 * Cleanup executor events
 */
export interface CleanupExecutorEvents {
  /** Emitted when detection starts */
  detectStart: () => void;
  /** Emitted when detection completes */
  detectComplete: (groups: DuplicateGroup[]) => void;
  /** Emitted when deletion starts */
  deleteStart: (totalItems: number) => void;
  /** Emitted with progress updates */
  progress: (stats: {
    processedGroups: number;
    totalGroups: number;
    deletedItems: number;
    totalItemsToDelete: number;
    failedDeletions: number;
    percent: number;
  }) => void;
  /** Emitted when all processing is complete */
  complete: (result: CleanupResult | CleanupDryRunPreview) => void;
  /** Emitted when processing encounters a fatal error */
  error: (error: Error) => void;
}

/**
 * Cleanup executor for duplicate detection and deletion
 */
export class CleanupExecutor extends EventEmitter {
  private client: PodioHttpClient;
  private config: CleanupExecutorConfig;
  private jobId: string;

  constructor(
    client: PodioHttpClient,
    jobId: string,
    config: CleanupExecutorConfig
  ) {
    super();
    this.client = client;
    this.jobId = jobId;
    this.config = config;
  }

  /**
   * Execute cleanup process
   */
  async execute(): Promise<CleanupResult | CleanupDryRunPreview> {
    try {
      logger.info('Starting cleanup execution', {
        jobId: this.jobId,
        appId: this.config.appId,
        matchField: this.config.matchField,
        mode: this.config.mode,
        dryRun: this.config.dryRun,
      });

      // Update job status to detecting
      await migrationStateStore.updateJobStatus(this.jobId, 'detecting' as any);

      // Step 1 & 2: Stream items and detect duplicate groups efficiently
      this.emit('detectStart');
      const duplicateGroups = await detectDuplicateGroups(
        this.client,
        this.config.appId,
        this.config.matchField
      );

      // Apply max groups limit if specified
      const limitedGroups = this.config.maxGroups
        ? duplicateGroups.slice(0, this.config.maxGroups)
        : duplicateGroups;

      this.emit('detectComplete', limitedGroups);

      // Step 3: Determine which items to delete
      let groupsToProcess: DuplicateGroup[];

      if (this.config.mode === 'manual') {
        // Manual mode: use approved groups
        if (this.config.approvedGroups && this.config.approvedGroups.length > 0) {
          // Ensure approved groups have deleteItemIds set
          // If not set (user didn't manually select), apply default keep strategy
          groupsToProcess = this.config.approvedGroups.map(group => {
            if (!group.deleteItemIds || group.deleteItemIds.length === 0) {
              // Apply default strategy if user didn't select specific items
              const processedGroups = applyKeepStrategy([group], this.config.keepStrategy);
              return processedGroups[0];
            }
            return group;
          });
        } else {
          // No approved groups yet - return for user approval
          logger.info('Manual mode: returning groups for approval', {
            jobId: this.jobId,
            groupCount: limitedGroups.length,
          });

          // Calculate summary statistics from detected groups
          const totalDuplicateItems = limitedGroups.reduce((sum, g) => sum + g.items.length, 0);
          const totalUniqueItems = limitedGroups.length;

          await migrationStateStore.updateJobStatus(this.jobId, 'waiting_approval' as any);

          // Store duplicate groups in job metadata for manual approval
          const job = await migrationStateStore.getMigrationJob(this.jobId);
          if (job) {
            job.metadata = {
              ...job.metadata,
              duplicateGroups: limitedGroups,
            };
            await migrationStateStore.saveMigrationJob(job);
          }

          const preview: CleanupDryRunPreview = {
            totalGroups: limitedGroups.length,
            totalItemsToDelete: 0,
            duplicateGroups: limitedGroups,
            summary: {
              totalSourceItems: totalDuplicateItems,
              uniqueItems: totalUniqueItems,
              duplicateItems: totalDuplicateItems - totalUniqueItems,
              groupsWithDuplicates: limitedGroups.length,
            },
          };

          this.emit('complete', preview);
          return preview;
        }
      } else {
        // Automated mode: apply keep strategy
        groupsToProcess = applyKeepStrategy(limitedGroups, this.config.keepStrategy);
      }

      // Calculate total items to delete
      const totalItemsToDelete = groupsToProcess.reduce(
        (sum, g) => sum + (g.deleteItemIds?.length || 0),
        0
      );

      logger.info('Groups processed with deletion plan', {
        jobId: this.jobId,
        totalGroups: groupsToProcess.length,
        totalItemsToDelete,
      });

      // If dry run, return preview
      if (this.config.dryRun) {
        // Calculate summary statistics from processed groups
        const totalDuplicateItems = groupsToProcess.reduce((sum, g) => sum + g.items.length, 0);
        const totalUniqueItems = groupsToProcess.length;

        const preview: CleanupDryRunPreview = {
          totalGroups: groupsToProcess.length,
          totalItemsToDelete,
          duplicateGroups: groupsToProcess,
          summary: {
            totalSourceItems: totalDuplicateItems,
            uniqueItems: totalUniqueItems,
            duplicateItems: totalItemsToDelete,
            groupsWithDuplicates: groupsToProcess.length,
          },
        };

        await migrationStateStore.updateJobStatus(this.jobId, 'completed');
        this.emit('complete', preview);
        return preview;
      }

      // Step 4: Delete duplicates
      await migrationStateStore.updateJobStatus(this.jobId, 'deleting' as any);
      this.emit('deleteStart', totalItemsToDelete);

      const result = await this.deleteDuplicates(groupsToProcess);

      // Update final status
      await migrationStateStore.updateJobStatus(
        this.jobId,
        result.failedDeletions > 0 ? 'completed' : 'completed'
      );

      this.emit('complete', result);
      return result;

    } catch (error) {
      logger.error('Cleanup execution failed', {
        jobId: this.jobId,
        error: error instanceof Error ? error.message : String(error),
      });

      await migrationStateStore.updateJobStatus(this.jobId, 'failed');
      this.emit('error', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }


  /**
   * Delete duplicate items
   */
  private async deleteDuplicates(groups: DuplicateGroup[]): Promise<CleanupResult> {
    const errors: Array<{ itemId?: number; message: string; code?: string }> = [];
    let deletedItems = 0;
    let failedDeletions = 0;
    let processedGroups = 0;

    // Collect all item IDs to delete
    const allItemsToDelete: number[] = [];
    for (const group of groups) {
      if (group.deleteItemIds && group.deleteItemIds.length > 0) {
        allItemsToDelete.push(...group.deleteItemIds);
      }
    }

    const totalItemsToDelete = allItemsToDelete.length;

    // Process deletions in batches
    const batchSize = this.config.batchSize;
    for (let i = 0; i < allItemsToDelete.length; i += batchSize) {
      const batch = allItemsToDelete.slice(i, i + batchSize);

      try {
        logger.info('Deleting batch', {
          jobId: this.jobId,
          batchNumber: Math.floor(i / batchSize) + 1,
          batchSize: batch.length,
          progress: `${i + batch.length}/${totalItemsToDelete}`,
        });

        const result = await bulkDeleteItems(this.client, batch, {
          concurrency: this.config.concurrency,
          stopOnError: false,
        });

        deletedItems += result.successCount;
        failedDeletions += result.failureCount;

        // Record errors
        for (const failure of result.failed) {
          errors.push({
            itemId: failure.itemId,
            message: failure.error,
          });
        }

        // Update progress
        processedGroups = Math.floor((i + batch.length) / totalItemsToDelete * groups.length);
        const percent = Math.round(((i + batch.length) / totalItemsToDelete) * 100);

        await migrationStateStore.updateJobProgress(this.jobId, {
          total: groups.length,
          processed: processedGroups,
          successful: deletedItems,
          failed: failedDeletions,
          percent,
        });

        this.emit('progress', {
          processedGroups,
          totalGroups: groups.length,
          deletedItems,
          totalItemsToDelete,
          failedDeletions,
          percent,
        });

      } catch (error) {
        logger.error('Batch deletion failed', {
          jobId: this.jobId,
          batchNumber: Math.floor(i / batchSize) + 1,
          error: error instanceof Error ? error.message : String(error),
        });

        failedDeletions += batch.length;
        errors.push({
          message: `Batch deletion failed: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }

    logger.info('Cleanup complete', {
      jobId: this.jobId,
      totalGroups: groups.length,
      deletedItems,
      failedDeletions,
    });

    return {
      jobId: this.jobId,
      totalGroups: groups.length,
      totalItemsDeleted: deletedItems,
      failedDeletions,
      errors,
    };
  }
}

/**
 * Execute cleanup job
 */
export async function executeCleanup(
  client: PodioHttpClient,
  jobId: string,
  request: CleanupRequestPayload
): Promise<CleanupResult | CleanupDryRunPreview> {
  // Normalize keepStrategy: 'manual' is only for manual mode, use 'oldest' as default
  const normalizedKeepStrategy: 'oldest' | 'newest' =
    request.keepStrategy === 'newest' ? 'newest' : 'oldest';

  const executor = new CleanupExecutor(client, jobId, {
    appId: request.appId,
    matchField: request.matchField,
    mode: request.mode,
    keepStrategy: normalizedKeepStrategy,
    batchSize: request.batchSize || 100,
    concurrency: request.concurrency || 3,
    dryRun: request.dryRun || false,
    maxGroups: request.maxGroups,
    approvedGroups: request.approvedGroups,
  });

  // Forward events to state store
  executor.on('progress', async (stats) => {
    await migrationStateStore.updateJobProgress(jobId, {
      total: stats.totalGroups,
      processed: stats.processedGroups,
      successful: stats.deletedItems,
      failed: stats.failedDeletions,
      percent: stats.percent,
    });
  });

  return executor.execute();
}
