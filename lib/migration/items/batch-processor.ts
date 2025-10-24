/**
 * Batch processor for large-scale item operations
 * Handles rate limiting, concurrency control, and retry logic
 */

import { EventEmitter } from 'events';
import { PodioHttpClient } from '../../podio/http/client';
import {
  CreateItemRequest,
  CreateItemResponse,
  bulkCreateItems,
  bulkUpdateItems,
  BulkCreateResult,
  BulkUpdateResult,
} from '../../podio/resources/items';
import { logger as migrationLogger, logMigrationEvent } from '../logging';
import { getRateLimitTracker } from '../../podio/http/rate-limit-tracker';
import { classifyError, ClassifiedError } from './error-classifier';
import { ErrorCategory, FailedItemDetail } from '../state-store';
import { MigrationFileLogger } from '../file-logger';
import { UpdateStatsTracker } from './update-stats-tracker';

/**
 * Batch processor configuration
 */
export interface BatchProcessorConfig {
  /** Maximum items per batch (default: 500) */
  batchSize: number;
  /** Maximum concurrent API requests (default: 5) */
  concurrency: number;
  /** Maximum retry attempts per item (default: 3) */
  maxRetries: number;
  /** Whether to stop processing on first error (default: false) */
  stopOnError: boolean;
  /** Whether to suppress notifications for creates/updates (default: true) */
  silent?: boolean;
  /** Whether to transfer files during updates (default: false) */
  transferFiles?: boolean;
}

/**
 * Batch item for processing
 */
export interface BatchItem {
  /** Item data to create or update */
  data: CreateItemRequest | { itemId: number; fields: Record<string, unknown> };
  /** Operation type */
  operation: 'create' | 'update';
  /** Original index in the input array */
  index: number;
  /** Number of retry attempts so far */
  retries: number;
}

/**
 * Batch processing result
 */
export interface BatchResult {
  successful: number;
  failed: number;
  total: number;
  failedItems: Array<{
    index: number;
    error: string;
    data: BatchItem['data'];
    classifiedError?: ClassifiedError;
    sourceItemId?: number;
  }>;
  /** Categorized failures for analytics */
  errorsByCategory?: Map<ErrorCategory, number>;
}

/**
 * Batch processor events
 */
export interface BatchProcessorEvents {
  /** Emitted when a batch starts processing */
  batchStart: (batchNumber: number, batchSize: number) => void;
  /** Emitted when an item succeeds */
  itemSuccess: (index: number, result: CreateItemResponse | { itemId: number; revision: number }) => void;
  /** Emitted when an item fails */
  itemFailed: (index: number, error: string, willRetry: boolean) => void;
  /** Emitted when a batch completes */
  batchComplete: (batchNumber: number, result: { successful: number; failed: number }) => void;
  /** Emitted with progress updates */
  progress: (stats: {
    processed: number;
    successful: number;
    failed: number;
    total: number;
    percent: number;
  }) => void;
  /** Emitted when all processing is complete */
  complete: (result: BatchResult) => void;
  /** Emitted when processing encounters a fatal error */
  error: (error: Error) => void;
  /** Emitted when processing pauses due to Podio rate limits */
  rateLimitPause: (payload: {
    remaining: number;
    limit: number;
    resumeAt: Date;
    reason?: 'batch_failures' | 'pre_batch_quota';
  }) => void;
  /** Emitted when processing resumes after a rate-limit pause */
  rateLimitResume: () => void;
}

/**
 * Item batch processor for controlled, resilient bulk operations
 *
 * Features:
 * - Rate limiting and concurrency control
 * - Per-item retry with exponential backoff
 * - Dead-letter queue for permanently failed items
 * - Progress tracking and event emission
 * - Memory-efficient streaming processing
 *
 * @example
 * const processor = new ItemBatchProcessor(client, appId, {
 *   batchSize: 500,
 *   concurrency: 5,
 *   silent: true, // Suppress notifications (default)
 * });
 *
 * processor.on('progress', (stats) => {
 *   console.log(`Progress: ${stats.percent}%`);
 * });
 *
 * const result = await processor.processCreate(items);
 */
export class ItemBatchProcessor extends EventEmitter {
  private client: PodioHttpClient;
  private appId: number;
  private config: BatchProcessorConfig;
  private stats: {
    processed: number;
    successful: number;
    failed: number;
    total: number;
  };
  private fileLogger: MigrationFileLogger | null = null;
  private updateStatsTracker: UpdateStatsTracker | null = null;

  constructor(
    client: PodioHttpClient,
    appId: number,
    config: Partial<BatchProcessorConfig> = {},
    fileLogger?: MigrationFileLogger,
    updateStatsTracker?: UpdateStatsTracker
  ) {
    super();

    this.client = client;
    this.appId = appId;
    this.config = {
      batchSize: config.batchSize || 500,
      concurrency: config.concurrency || 5,
      maxRetries: config.maxRetries || 3,
      stopOnError: config.stopOnError || false,
      silent: config.silent !== undefined ? config.silent : true, // Default to silent mode
      transferFiles: config.transferFiles ?? false,
    };
    this.stats = {
      processed: 0,
      successful: 0,
      failed: 0,
      total: 0,
    };
    this.fileLogger = fileLogger || null;
    this.updateStatsTracker = updateStatsTracker || null;

    migrationLogger.info('Batch processor initialized', {
      appId: this.appId,
      config: this.config,
      hasFileLogger: !!this.fileLogger,
      hasUpdateStatsTracker: !!this.updateStatsTracker,
    });
  }

  /**
   * Process a batch of create operations
   */
  async processCreate(
    items: CreateItemRequest[]
  ): Promise<BatchResult> {
    this.stats.total = items.length;
    this.stats.processed = 0;
    this.stats.successful = 0;
    this.stats.failed = 0;

    migrationLogger.info('Starting batch create processing', {
      appId: this.appId,
      totalItems: items.length,
      batchSize: this.config.batchSize,
    });

    const result: BatchResult = {
      successful: 0,
      failed: 0,
      total: items.length,
      failedItems: [],
      errorsByCategory: new Map(),
    };

    // Process in batches
    const batches = Math.ceil(items.length / this.config.batchSize);
    const tracker = getRateLimitTracker();

    for (let batchNum = 0; batchNum < batches; batchNum++) {
      const start = batchNum * this.config.batchSize;
      const end = Math.min(start + this.config.batchSize, items.length);
      const batch = items.slice(start, end);

      // Proactive rate limit check - pause if approaching limit
      if (tracker.shouldPause(10)) {
        const timeUntilReset = Math.max(0, tracker.getTimeUntilReset());
        const resumeAt = new Date(Date.now() + timeUntilReset);

        migrationLogger.warn('Approaching rate limit - pausing before batch', {
          appId: this.appId,
          batchNumber: batchNum + 1,
          remaining: tracker.getRemainingQuota(),
          limit: tracker.getLimit(),
          timeUntilResetMin: Math.round(timeUntilReset / 60000),
          resumeAt: resumeAt.toISOString(),
        });

        this.emit('rateLimitPause', {
          remaining: tracker.getRemainingQuota(),
          limit: tracker.getLimit(),
          resumeAt,
          reason: 'pre_batch_quota',
        });

        // Wait for rate limit reset
        await tracker.waitForReset();

        migrationLogger.info('Rate limit reset - resuming batch processing', {
          appId: this.appId,
          batchNumber: batchNum + 1,
        });

        this.emit('rateLimitResume');
      }

      this.emit('batchStart', batchNum + 1, batch.length);

      migrationLogger.info('Processing batch', {
        appId: this.appId,
        batchNumber: batchNum + 1,
        totalBatches: batches,
        batchSize: batch.length,
        rateLimitStatus: tracker.getStatus(),
      });

      try {
        const batchResult = await bulkCreateItems(
          this.client,
          this.appId,
          batch,
          {
            concurrency: this.config.concurrency,
            stopOnError: this.config.stopOnError,
            retryConfig: { maxAttempts: this.config.maxRetries },
            silent: this.config.silent,
          }
        );

        // Update stats
        this.stats.successful += batchResult.successCount;
        this.stats.failed += batchResult.failureCount;
        this.stats.processed += batch.length;

        result.successful += batchResult.successCount;
        result.failed += batchResult.failureCount;

        // Emit item-level events
        batchResult.successful.forEach((item, idx) => {
          this.emit('itemSuccess', start + idx, item);
        });

        batchResult.failed.forEach((failure) => {
          const globalIndex = start + failure.index;

          // Classify the error
          const classifiedError = classifyError(new Error(failure.error));

          // Track by category
          const categoryCount = result.errorsByCategory!.get(classifiedError.category) || 0;
          result.errorsByCategory!.set(classifiedError.category, categoryCount + 1);

          migrationLogger.debug('Item failed with classified error', {
            appId: this.appId,
            index: globalIndex,
            category: classifiedError.category,
            shouldRetry: classifiedError.shouldRetry,
            error: failure.error,
          });

          this.emit('itemFailed', globalIndex, failure.error, false);
          result.failedItems.push({
            index: globalIndex,
            error: failure.error,
            data: failure.request,
            classifiedError,
          });
        });

        this.emit('batchComplete', batchNum + 1, {
          successful: batchResult.successCount,
          failed: batchResult.failureCount,
        });

        // Emit progress
        this.emitProgress();

        migrationLogger.info('Batch complete', {
          appId: this.appId,
          batchNumber: batchNum + 1,
          successful: batchResult.successCount,
          failed: batchResult.failureCount,
        });

        // Check if we hit rate limits during this batch
        // If so, pause before starting the next batch to avoid hammering the API
        const hasRateLimitErrors = batchResult.failed.some(
          failure => {
            const errorMsg = failure.error.toLowerCase();
            return errorMsg.includes('rate limit') ||
                   errorMsg.includes('429') ||
                   errorMsg.includes('420');
          }
        );

        if (hasRateLimitErrors && batchNum < batches - 1) {
          const timeUntilReset = tracker.getTimeUntilReset();

          if (timeUntilReset > 0) {
            const resumeAt = new Date(Date.now() + timeUntilReset);

            migrationLogger.warn('Rate limit errors detected in batch - pausing before next batch', {
              appId: this.appId,
              batchNumber: batchNum + 1,
              nextBatch: batchNum + 2,
              rateLimitFailures: batchResult.failed.filter(f => {
                const msg = f.error.toLowerCase();
                return msg.includes('rate limit') || msg.includes('429') || msg.includes('420');
              }).length,
              timeUntilResetMin: Math.round(timeUntilReset / 60000),
              resumeAt: resumeAt.toISOString(),
            });

            this.emit('rateLimitPause', {
              remaining: tracker.getRemainingQuota(),
              limit: tracker.getLimit(),
              resumeAt,
              reason: 'batch_failures',
            });

            await tracker.waitForReset();

            migrationLogger.info('Rate limit reset complete - resuming batch processing', {
              appId: this.appId,
              nextBatch: batchNum + 2,
            });

            this.emit('rateLimitResume');
          }
        }
      } catch (error) {
        migrationLogger.error('Batch processing failed', {
          appId: this.appId,
          batchNumber: batchNum + 1,
          error: error instanceof Error ? error.message : String(error),
        });

        this.emit('error', error instanceof Error ? error : new Error(String(error)));

        if (this.config.stopOnError) {
          break;
        }
      }
    }

    this.emit('complete', result);

    migrationLogger.info('Batch create processing complete', {
      appId: this.appId,
      total: result.total,
      successful: result.successful,
      failed: result.failed,
    });

    return result;
  }

  /**
   * Process a batch of update operations
   */
  async processUpdate(
    updates: Array<{ itemId: number; fields: Record<string, unknown>; sourceItemId?: number }>
  ): Promise<BatchResult> {
    this.stats.total = updates.length;
    this.stats.processed = 0;
    this.stats.successful = 0;
    this.stats.failed = 0;

    migrationLogger.info('Starting batch update processing', {
      totalItems: updates.length,
      batchSize: this.config.batchSize,
    });

    const result: BatchResult = {
      successful: 0,
      failed: 0,
      total: updates.length,
      failedItems: [],
      errorsByCategory: new Map(),
    };

    // Process in batches
    const batches = Math.ceil(updates.length / this.config.batchSize);
    const tracker = getRateLimitTracker();

    for (let batchNum = 0; batchNum < batches; batchNum++) {
      const start = batchNum * this.config.batchSize;
      const end = Math.min(start + this.config.batchSize, updates.length);
      const batch = updates.slice(start, end);

      // Proactive rate limit check - pause if approaching limit
      if (tracker.shouldPause(10)) {
        const timeUntilReset = Math.max(0, tracker.getTimeUntilReset());
        const resumeAt = new Date(Date.now() + timeUntilReset);

        migrationLogger.warn('Approaching rate limit - pausing before batch', {
          batchNumber: batchNum + 1,
          remaining: tracker.getRemainingQuota(),
          limit: tracker.getLimit(),
          timeUntilResetMin: Math.round(timeUntilReset / 60000),
          resumeAt: resumeAt.toISOString(),
        });

        this.emit('rateLimitPause', {
          remaining: tracker.getRemainingQuota(),
          limit: tracker.getLimit(),
          resumeAt,
          reason: 'pre_batch_quota',
        });

        // Wait for rate limit reset
        await tracker.waitForReset();

        migrationLogger.info('Rate limit reset - resuming batch processing', {
          batchNumber: batchNum + 1,
        });

        this.emit('rateLimitResume');
      }

      this.emit('batchStart', batchNum + 1, batch.length);

      migrationLogger.info('Processing batch', {
        batchNumber: batchNum + 1,
        totalBatches: batches,
        batchSize: batch.length,
        rateLimitStatus: tracker.getStatus(),
      });

      // Log UPDATE batch start
      if (this.fileLogger) {
        await this.fileLogger.logUpdate('INFO', 'update_batch_started', {
          batchNumber: batchNum + 1,
          itemCount: batch.length,
          targetItemIds: batch.map(u => u.itemId),
        });
      }

      try {
        // Check if this is a file-only migration (empty fields + transferFiles enabled)
        const isFileOnlyMigration = this.config.transferFiles &&
          batch.every(update => Object.keys(update.fields).length === 0);

        let batchResult: BulkUpdateResult;

        if (isFileOnlyMigration) {
          // File-only migration: Skip item updates, only transfer files
          migrationLogger.info('File-only migration detected - skipping field updates', {
            batchNumber: batchNum + 1,
            itemCount: batch.length,
          });

          // Create a mock successful result (no actual API calls for updates)
          batchResult = {
            successful: batch.map((update, idx) => ({
              itemId: update.itemId,
              revision: 0, // No revision change since we didn't update
            })),
            failed: [],
            successCount: batch.length,
            failureCount: 0,
          };
        } else {
          // Normal migration: Update item fields
          batchResult = await bulkUpdateItems(
            this.client,
            batch,
            {
              concurrency: this.config.concurrency,
              stopOnError: this.config.stopOnError,
              retryConfig: { maxAttempts: this.config.maxRetries },
              silent: this.config.silent,
            }
          );
        }

        // If file transfer is enabled, transfer files from source to target
        let transferItemFiles: ((client: PodioHttpClient, sourceItemId: number, targetItemId: number) => Promise<number[]>) | null = null;
        if (this.config.transferFiles) {
          const filesModule = await import('../../podio/resources/files');
          transferItemFiles = filesModule.transferItemFiles;
        }

        if (transferItemFiles) {
          const transferFilesFn = transferItemFiles;
          const successfulItemIds = new Set(batchResult.successful.map((item) => item.itemId));
          type UpdateWithSource = { itemId: number; fields: Record<string, unknown>; sourceItemId: number };
          const transferCandidates = batch.filter(
            (update): update is UpdateWithSource =>
              typeof update.sourceItemId === 'number' && successfulItemIds.has(update.itemId)
          );

          // Track file transfer failures for file-only migrations
          let transferFailureCount = 0;
          const transferFailures: Array<{ sourceItemId: number; targetItemId: number; error: string }> = [];

          if (transferCandidates.length > 0) {
            migrationLogger.info('Transferring files for updated items', {
              batchNumber: batchNum + 1,
              itemCount: transferCandidates.length,
              concurrency: this.config.concurrency,
            });

            const transferConcurrency = Math.max(1, this.config.concurrency || 1);
            for (let i = 0; i < transferCandidates.length; i += transferConcurrency) {
              const transferBatch = transferCandidates.slice(i, i + transferConcurrency);
              const results = await Promise.allSettled(
                transferBatch.map(async (update) => {
                  const transferredFileIds = await transferFilesFn(
                    this.client,
                    update.sourceItemId,
                    update.itemId
                  );

                  migrationLogger.info('Files transferred for item', {
                    sourceItemId: update.sourceItemId,
                    targetItemId: update.itemId,
                    fileCount: transferredFileIds.length,
                  });

                  return transferredFileIds;
                })
              );

              results.forEach((result, idx) => {
                const update = transferBatch[idx];
                if (result.status === 'rejected') {
                  const error = result.reason;
                  const errorMessage = error instanceof Error ? error.message : String(error);

                  migrationLogger.warn('Failed to transfer files for item', {
                    sourceItemId: update.sourceItemId,
                    targetItemId: update.itemId,
                    error: errorMessage,
                  });

                  transferFailureCount++;
                  transferFailures.push({
                    sourceItemId: update.sourceItemId,
                    targetItemId: update.itemId,
                    error: errorMessage,
                  });
                }
              });
            }
          } else {
            migrationLogger.info('No eligible items for file transfer in batch', {
              batchNumber: batchNum + 1,
            });
          }

          // If this was a file-only batch, reflect transfer failures in batchResult only
          // (let unified stats logic handle everything)
          if (isFileOnlyMigration && transferFailureCount > 0) {
            migrationLogger.warn('File-only migration had transfer failures', {
              batchNumber: batchNum + 1,
              transferFailureCount,
              totalBatchItems: batch.length,
            });

            // Update batchResult to mark these items as failed
            transferFailures.forEach(({ sourceItemId, targetItemId, error }) => {
              // Remove from successful list
              const successIdx = batchResult.successful.findIndex(s => s.itemId === targetItemId);
              if (successIdx >= 0) {
                batchResult.successful.splice(successIdx, 1);
                batchResult.successCount--;
              }

              // Find the item in the batch to get its index
              const batchIdx = batch.findIndex(u => u.itemId === targetItemId);

              // Add to batchResult.failed (unified loop will handle result.failedItems and stats)
              batchResult.failed.push({
                itemId: targetItemId,
                fields: {},
                error: `File transfer failed: ${error}`,
                index: batchIdx >= 0 ? batchIdx : 0,
              });
              batchResult.failureCount++;
            });
          }
        }

        // Update stats
        this.stats.successful += batchResult.successCount;
        this.stats.failed += batchResult.failureCount;
        this.stats.processed += batch.length;

        result.successful += batchResult.successCount;
        result.failed += batchResult.failureCount;

        // Emit item-level events
        // Map itemId → original batch index to avoid misaligned indices after removals
        const idToBatchIndex = new Map<number, number>(batch.map((u, i) => [u.itemId, i]));
        batchResult.successful.forEach((item) => {
          const batchIdx = idToBatchIndex.get(item.itemId);
          const globalIndex = batchIdx != null ? start + batchIdx : start;
          this.emit('itemSuccess', globalIndex, item);

          // Log successful update
          const batchItem = batch[batchIdx!];
          if (this.fileLogger && batchItem) {
            this.fileLogger.logUpdate('DEBUG', 'update_item_success', {
              sourceItemId: batchItem.sourceItemId,
              targetItemId: item.itemId,
              fieldsUpdated: Object.keys(batchItem.fields),
            });
          }

          // Record in stats tracker
          if (this.updateStatsTracker) {
            this.updateStatsTracker.recordUpdateAttempt(true);
          }
        });

        batchResult.failed.forEach((failure) => {
          const globalIndex = start + failure.index;

          // Classify the error
          const classifiedError = classifyError(new Error(failure.error));

          // Track by category
          const categoryCount = result.errorsByCategory!.get(classifiedError.category) || 0;
          result.errorsByCategory!.set(classifiedError.category, categoryCount + 1);

          migrationLogger.debug('Update failed with classified error', {
            index: globalIndex,
            itemId: failure.itemId,
            category: classifiedError.category,
            shouldRetry: classifiedError.shouldRetry,
            error: failure.error,
          });

          // Log failed update (with error handling to prevent unhandled rejections)
          const batchItem = batch[failure.index];
          if (this.fileLogger && batchItem) {
            this.fileLogger.logUpdate('ERROR', 'update_item_failed', {
              sourceItemId: batchItem.sourceItemId,
              targetItemId: failure.itemId,
              error: failure.error,
              errorCategory: classifiedError.category,
            }).catch(() => {});

            // Also log to failures.log (with error handling)
            this.fileLogger.logFailure('update_operation_failed', {
              sourceItemId: batchItem.sourceItemId,
              targetItemId: failure.itemId,
              error: failure.error,
              errorCategory: classifiedError.category,
              fieldsAttempted: Object.keys(batchItem.fields),
            }).catch(() => {});
          }

          // Record in stats tracker
          if (this.updateStatsTracker) {
            this.updateStatsTracker.recordUpdateAttempt(false);
          }

          this.emit('itemFailed', globalIndex, failure.error, false);
          result.failedItems.push({
            index: globalIndex,
            error: failure.error,
            data: { itemId: failure.itemId, fields: failure.fields },
            classifiedError,
            sourceItemId: batch[failure.index]?.sourceItemId, // Track source item ID
          });
        });

        this.emit('batchComplete', batchNum + 1, {
          successful: batchResult.successCount,
          failed: batchResult.failureCount,
        });

        // Log UPDATE batch completion (with error handling to prevent unhandled rejections)
        if (this.fileLogger) {
          await this.fileLogger.logUpdate('INFO', 'update_batch_complete', {
            batchNumber: batchNum + 1,
            successCount: batchResult.successCount,
            failedCount: batchResult.failureCount,
            totalProcessed: this.stats.processed,
            totalSuccessful: this.stats.successful,
            totalFailed: this.stats.failed,
          }).catch(() => {});
        }

        // Emit progress
        this.emitProgress();

        migrationLogger.info('Batch complete', {
          batchNumber: batchNum + 1,
          successful: batchResult.successCount,
          failed: batchResult.failureCount,
        });

        // Check if we hit rate limits during this batch
        // If so, pause before starting the next batch to avoid hammering the API
        const hasRateLimitErrors = batchResult.failed.some(
          failure => {
            const errorMsg = failure.error.toLowerCase();
            return errorMsg.includes('rate limit') ||
                   errorMsg.includes('429') ||
                   errorMsg.includes('420');
          }
        );

        if (hasRateLimitErrors && batchNum < batches - 1) {
          const timeUntilReset = tracker.getTimeUntilReset();

          if (timeUntilReset > 0) {
            const resumeAt = new Date(Date.now() + timeUntilReset);

            migrationLogger.warn('Rate limit errors detected in batch - pausing before next batch', {
              batchNumber: batchNum + 1,
              nextBatch: batchNum + 2,
              rateLimitFailures: batchResult.failed.filter(f => {
                const msg = f.error.toLowerCase();
                return msg.includes('rate limit') || msg.includes('429') || msg.includes('420');
              }).length,
              timeUntilResetMin: Math.round(timeUntilReset / 60000),
              resumeAt: resumeAt.toISOString(),
            });

            this.emit('rateLimitPause', {
              remaining: tracker.getRemainingQuota(),
              limit: tracker.getLimit(),
              resumeAt,
              reason: 'batch_failures',
            });

            // Log rate limit pause for UPDATE operations
            if (this.fileLogger) {
              await this.fileLogger.logUpdate('WARN', 'rate_limit_pause', {
                batchNumber: batchNum + 1,
                rateLimitFailures: batchResult.failed.filter(f => {
                  const msg = f.error.toLowerCase();
                  return msg.includes('rate limit') || msg.includes('429') || msg.includes('420');
                }).length,
                timeUntilResetMin: Math.round(timeUntilReset / 60000),
              }).catch(() => {});
            }

            await tracker.waitForReset();

            migrationLogger.info('Rate limit reset complete - resuming batch processing', {
              nextBatch: batchNum + 2,
            });

            this.emit('rateLimitResume');
          }
        }
      } catch (error) {
        migrationLogger.error('Batch processing failed', {
          batchNumber: batchNum + 1,
          error: error instanceof Error ? error.message : String(error),
        });

        this.emit('error', error instanceof Error ? error : new Error(String(error)));

        if (this.config.stopOnError) {
          break;
        }
      }
    }

    this.emit('complete', result);

    migrationLogger.info('Batch update processing complete', {
      total: result.total,
      successful: result.successful,
      failed: result.failed,
    });

    return result;
  }

  /**
   * Get current processing statistics
   */
  getStats() {
    return {
      ...this.stats,
      percent: this.stats.total > 0
        ? Math.round((this.stats.processed / this.stats.total) * 100)
        : 0,
    };
  }

  /**
   * Emit progress event
   */
  private emitProgress() {
    const stats = this.getStats();
    this.emit('progress', stats);
  }

  /**
   * Get error statistics by category
   */
  getErrorStats(errorsByCategory: Map<ErrorCategory, number>): Array<{
    category: ErrorCategory;
    count: number;
    percentage: number;
  }> {
    const total = Array.from(errorsByCategory.values()).reduce((sum, count) => sum + count, 0);

    return Array.from(errorsByCategory.entries()).map(([category, count]) => ({
      category,
      count,
      percentage: total > 0 ? Math.round((count / total) * 100) : 0,
    }));
  }
}
