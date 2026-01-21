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
import { ItemMigrationFilters } from '../items/types';
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
  filters?: ItemMigrationFilters;
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
  private pauseRequested: boolean = false;

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
   * Request pause of cleanup execution
   */
  requestPause(): void {
    this.pauseRequested = true;
    logger.info('Pause requested for cleanup job', { jobId: this.jobId });
  }

  /**
   * Check if pause was requested
   */
  private checkPause(): void {
    if (this.pauseRequested) {
      logger.info('Pause detected - stopping cleanup execution', { jobId: this.jobId });
      throw new Error('PAUSE_REQUESTED');
    }
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
        this.config.matchField,
        {
          jobId: this.jobId,
          onPauseCheck: () => this.pauseRequested,
          filters: this.config.filters,
        }
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
      await migrationStateStore.updateJobStatus(this.jobId, 'completed');

      this.emit('complete', result);
      return result;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Handle pause request gracefully
      if (errorMessage === 'PAUSE_REQUESTED') {
        logger.info('Cleanup execution paused by user request', {
          jobId: this.jobId,
        });

        await migrationStateStore.updateJobStatus(this.jobId, 'paused');

        // Don't emit error for pause requests - this is expected behavior
        return {
          jobId: this.jobId,
          totalGroups: 0,
          totalItemsDeleted: 0,
          failedDeletions: 0,
          errors: [],
        };
      }

      logger.error('Cleanup execution failed', {
        jobId: this.jobId,
        error: errorMessage,
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
      // Check for pause request before each batch
      this.checkPause();

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
          lastUpdate: new Date(),
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
 * Global registry of active cleanup executors for pause support
 */
class CleanupExecutorRegistry {
  private executors: Map<string, CleanupExecutor> = new Map();

  register(jobId: string, executor: CleanupExecutor): void {
    this.executors.set(jobId, executor);
    logger.debug('Registered cleanup executor', { jobId, total: this.executors.size });
  }

  unregister(jobId: string): void {
    this.executors.delete(jobId);
    logger.debug('Unregistered cleanup executor', { jobId, remaining: this.executors.size });
  }

  get(jobId: string): CleanupExecutor | undefined {
    return this.executors.get(jobId);
  }

  requestPause(jobId: string): boolean {
    const executor = this.executors.get(jobId);
    if (executor) {
      executor.requestPause();
      return true;
    }
    return false;
  }
}

// Global registry instance
const cleanupExecutorRegistry = new CleanupExecutorRegistry();

/**
 * Request pause for a cleanup job
 * Returns true if executor was found and pause requested, false otherwise
 */
export function requestCleanupPause(jobId: string): boolean {
  return cleanupExecutorRegistry.requestPause(jobId);
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
    filters: request.filters,
  });

  // Register executor for pause support
  cleanupExecutorRegistry.register(jobId, executor);

  try {
    // Forward events to state store
    executor.on('progress', async (stats) => {
      await migrationStateStore.updateJobProgress(jobId, {
        total: stats.totalGroups,
        processed: stats.processedGroups,
        successful: stats.deletedItems,
        failed: stats.failedDeletions,
        percent: stats.percent,
        lastUpdate: new Date(),
      });
    });

    return await executor.execute();
  } finally {
    // Always unregister executor when done
    cleanupExecutorRegistry.unregister(jobId);
  }
}
