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

  constructor(
    client: PodioHttpClient,
    appId: number,
    config: Partial<BatchProcessorConfig> = {}
  ) {
    super();

    this.client = client;
    this.appId = appId;
    this.config = {
      batchSize: config.batchSize || 500,
      concurrency: config.concurrency || 5,
      maxRetries: config.maxRetries || 3,
      stopOnError: config.stopOnError || false,
    };
    this.stats = {
      processed: 0,
      successful: 0,
      failed: 0,
      total: 0,
    };

    migrationLogger.info('Batch processor initialized', {
      appId: this.appId,
      config: this.config,
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

    for (let batchNum = 0; batchNum < batches; batchNum++) {
      const start = batchNum * this.config.batchSize;
      const end = Math.min(start + this.config.batchSize, items.length);
      const batch = items.slice(start, end);

      // Proactive rate limit check - pause if approaching limit
      const tracker = getRateLimitTracker();
      if (tracker.shouldPause(10)) {
        const timeUntilReset = tracker.getTimeUntilReset();
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

    for (let batchNum = 0; batchNum < batches; batchNum++) {
      const start = batchNum * this.config.batchSize;
      const end = Math.min(start + this.config.batchSize, updates.length);
      const batch = updates.slice(start, end);

      // Proactive rate limit check - pause if approaching limit
      const tracker = getRateLimitTracker();
      if (tracker.shouldPause(10)) {
        const timeUntilReset = tracker.getTimeUntilReset();
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

      try {
        const batchResult = await bulkUpdateItems(
          this.client,
          batch,
          {
            concurrency: this.config.concurrency,
            stopOnError: this.config.stopOnError,
            retryConfig: { maxAttempts: this.config.maxRetries },
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

          migrationLogger.debug('Update failed with classified error', {
            index: globalIndex,
            itemId: failure.itemId,
            category: classifiedError.category,
            shouldRetry: classifiedError.shouldRetry,
            error: failure.error,
          });

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

        // Emit progress
        this.emitProgress();

        migrationLogger.info('Batch complete', {
          batchNumber: batchNum + 1,
          successful: batchResult.successCount,
          failed: batchResult.failureCount,
        });
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
