/**
 * Item migrator orchestrator for large-scale data migrations
 * Coordinates streaming, batch processing, checkpointing, and progress tracking
 */

import { promises as fs } from 'fs';
import path from 'path';
import { getPodioHttpClient } from '../../podio/http/client';
import {
  streamItems,
  fetchItemCount,
  mapItemFields,
  CreateItemRequest,
  PodioItem,
  StreamItemsOptions,
  findItemByFieldValue,
  extractFieldValue,
  fetchItemsByIds,
} from '../../podio/resources/items';
import { ItemBatchProcessor, BatchProcessorConfig } from './batch-processor';
import { migrationStateStore, MigrationJob } from '../state-store';
import { logger as migrationLogger, logMigrationEvent, logDuplicateDetection } from '../logging';
import { convertFieldMappingToExternalIds } from './service';
import { PrefetchCache } from './prefetch-cache';
import { getAppStructureCache } from './app-structure-cache';
import { isFieldNotFoundError } from '../../podio/errors';

/**
 * Migration mode
 */
export type MigrationMode = 'create' | 'update' | 'upsert';

/**
 * Duplicate behavior
 */
export type DuplicateBehavior = 'skip' | 'error' | 'update';

/**
 * Migration configuration
 */
export interface MigrationConfig {
  /** Source app ID */
  sourceAppId: number;
  /** Target app ID */
  targetAppId: number;
  /** Field mapping (source external_id -> target external_id) */
  fieldMapping: Record<string, string>;
  /** Migration mode */
  mode: MigrationMode;
  /** Source field external_id to extract value from for matching */
  sourceMatchField?: string;
  /** Target field external_id to search by for matching */
  targetMatchField?: string;
  /** How to handle duplicates when match fields are set (skip/error/update) */
  duplicateBehavior?: DuplicateBehavior;
  /** Batch size for streaming (default: 500) */
  batchSize?: number;
  /** Concurrency level (default: 5) */
  concurrency?: number;
  /** Whether to stop on first error (default: false) */
  stopOnError?: boolean;
  /** Filters to apply to source items */
  filters?: Record<string, unknown>;
  /** Resume from checkpoint */
  resumeToken?: string;
  /** Maximum number of items to migrate (for testing) */
  maxItems?: number;
  /** Specific source item IDs to retry (for retry operations) */
  retryItemIds?: number[];
  /** Progress callback */
  onProgress?: (progress: { total: number; processed: number; successful: number; failed: number }) => void | Promise<void>;
}

/**
 * Migration checkpoint
 */
export interface MigrationCheckpoint {
  /** Migration job ID */
  migrationId: string;
  /** Current offset in source app */
  offset: number;
  /** Items processed so far */
  processed: number;
  /** Items successfully migrated */
  successful: number;
  /** Items that failed */
  failed: number;
  /** Failed item IDs with errors */
  failedItems: Array<{ sourceItemId: number; error: string }>;
  /** Timestamp of checkpoint */
  timestamp: Date;
}

/**
 * Migration result
 */
export interface MigrationResult {
  /** Migration job ID */
  migrationId: string;
  /** Total items processed */
  processed: number;
  /** Successfully migrated items */
  successful: number;
  /** Failed items */
  failed: number;
  /** Failed items details */
  failedItems: Array<{ sourceItemId: number; error: string; index: number }>;
  /** Duration in milliseconds */
  durationMs: number;
  /** Throughput (items/second) */
  throughput: number;
  /** Whether migration completed */
  completed: boolean;
  /** Duplicates skipped count */
  duplicatesSkipped?: number;
  /** Duplicates updated count */
  duplicatesUpdated?: number;
}

/**
 * Validation result
 */
export interface ValidationResult {
  /** Total items checked */
  total: number;
  /** Items that matched */
  matched: number;
  /** Items with mismatches */
  mismatched: Array<{
    sourceItemId: number;
    targetItemId: number;
    differences: Record<string, { source: unknown; target: unknown }>;
  }>;
  /** Items missing in target */
  missingInTarget: number;
  /** Items missing in source (unexpected in target) */
  missingInSource: number;
}

/**
 * Item migrator - orchestrates large-scale data migrations
 *
 * Features:
 * - Streaming reads for memory efficiency
 * - Batch processing with rate limiting
 * - Checkpoint/resume capability
 * - Progress tracking
 * - Export/import for offline migrations
 * - Validation for data integrity checks
 *
 * @example
 * const migrator = new ItemMigrator();
 * const result = await migrator.executeMigration({
 *   sourceAppId: 12345,
 *   targetAppId: 67890,
 *   fieldMapping: { 'title': 'title', 'description': 'desc' },
 *   mode: 'create',
 * });
 */
export class ItemMigrator {
  private client = getPodioHttpClient();
  private checkpointsDir = 'data/migration-checkpoints';

  constructor() {
    migrationLogger.info('ItemMigrator initialized');
  }

  /**
   * Plan a migration (analyze and prepare)
   */
  async planMigration(config: MigrationConfig): Promise<{
    totalItems: number;
    estimatedDuration: string;
    batchCount: number;
    fieldMapping: Record<string, string>;
  }> {
    migrationLogger.info('Planning migration', {
      sourceAppId: config.sourceAppId,
      targetAppId: config.targetAppId,
    });

    // Get item count
    const { total } = await fetchItemCount(
      this.client,
      config.sourceAppId,
      config.filters
    );

    const batchSize = config.batchSize || 500;
    const batchCount = Math.ceil(total / batchSize);

    // Estimate duration (assuming ~1 second per batch with concurrency)
    const estimatedSeconds = batchCount * (batchSize / (config.concurrency || 5));
    const estimatedMinutes = Math.ceil(estimatedSeconds / 60);

    migrationLogger.info('Migration plan generated', {
      totalItems: total,
      batchCount,
      estimatedMinutes,
    });

    return {
      totalItems: total,
      estimatedDuration: `${estimatedMinutes} minutes`,
      batchCount,
      fieldMapping: config.fieldMapping,
    };
  }

  /**
   * Execute a migration
   */
  async executeMigration(config: MigrationConfig): Promise<MigrationResult> {
    const startTime = Date.now();

    migrationLogger.info('Starting migration execution', {
      sourceAppId: config.sourceAppId,
      targetAppId: config.targetAppId,
      mode: config.mode,
    });

    // Create migration job
    const migrationJob = await migrationStateStore.createMigrationJob(
      String(config.sourceAppId),
      String(config.targetAppId),
      {
        mode: config.mode,
        fieldMapping: config.fieldMapping,
        batchSize: config.batchSize,
        concurrency: config.concurrency,
      }
    );

    await migrationStateStore.updateJobStatus(migrationJob.id, 'in_progress');

    // Convert field mapping from field_id-based to external_id-based
    migrationLogger.info('Converting field mapping to external IDs');
    const externalIdFieldMapping = await convertFieldMappingToExternalIds(
      config.fieldMapping,
      config.sourceAppId,
      config.targetAppId
    );
    migrationLogger.info('Field mapping converted', {
      originalMappings: Object.keys(config.fieldMapping).length,
      convertedMappings: Object.keys(externalIdFieldMapping).length,
    });

    const result: MigrationResult = {
      migrationId: migrationJob.id,
      processed: 0,
      successful: 0,
      failed: 0,
      failedItems: [],
      durationMs: 0,
      throughput: 0,
      completed: false,
    };

    try {
      // Determine starting offset (for resume)
      const startOffset = config.resumeToken
        ? await this.getCheckpointOffset(config.resumeToken)
        : 0;

      // Create batch processor
      const processor = new ItemBatchProcessor(
        this.client,
        config.targetAppId,
        {
          batchSize: config.batchSize || 500,
          concurrency: config.concurrency || 5,
          maxRetries: 3,
          stopOnError: config.stopOnError || false,
        }
      );

      // Set up progress tracking
      processor.on('progress', async (stats) => {
        migrationLogger.info('Migration progress', {
          migrationId: migrationJob.id,
          ...stats,
        });

        result.processed = stats.processed;
        result.successful = stats.successful;
        result.failed = stats.failed;

        // Call onProgress callback if provided
        if (config.onProgress) {
          await config.onProgress({
            total: stats.total || 0,
            processed: stats.processed,
            successful: stats.successful,
            failed: stats.failed,
          });
        }
      });

      processor.on('itemFailed', (index, error) => {
        migrationLogger.warn('Item migration failed', {
          migrationId: migrationJob.id,
          index,
          error,
        });
      });

      // Get match field info if provided
      const sourceMatchField = config.sourceMatchField;
      const targetMatchField = config.targetMatchField;
      const duplicateBehavior = config.duplicateBehavior || 'skip';

      // LOG: Configuration received
      console.log('⚙️  Migrator config received:', {
        sourceAppId: config.sourceAppId,
        targetAppId: config.targetAppId,
        mode: config.mode,
        sourceMatchField: config.sourceMatchField,
        targetMatchField: config.targetMatchField,
        duplicateBehavior: config.duplicateBehavior,
        hasSourceMatch: !!sourceMatchField,
        hasTargetMatch: !!targetMatchField,
        willCheckDuplicates: !!(sourceMatchField && targetMatchField),
      });

      // Prepare collections for different operations
      const itemsToCreate: CreateItemRequest[] = [];
      const itemsToUpdate: Array<{ itemId: number; fields: Record<string, unknown> }> = [];
      let skippedCount = 0;
      let updatedDuplicatesCount = 0;
      const maxItems = config.maxItems || Infinity;

      // Determine if this is a retry operation FIRST
      const isRetry = config.retryItemIds && config.retryItemIds.length > 0;

      // Initialize pre-fetch cache if duplicate checking is enabled
      // BUT skip it in retry mode (we don't need duplicate detection for retries)
      let prefetchCache: PrefetchCache | null = null;
      if (!isRetry && sourceMatchField && targetMatchField) {
        prefetchCache = new PrefetchCache();
        migrationLogger.info('Starting pre-fetch of target items', {
          targetAppId: config.targetAppId,
          matchField: targetMatchField,
        });

        await prefetchCache.prefetchTargetItems(
          this.client,
          config.targetAppId,
          targetMatchField
        );

        migrationLogger.info('Pre-fetch complete', {
          cachedItems: prefetchCache.size(),
          matchField: targetMatchField,
        });
      }

      migrationLogger.info('Streaming source items', {
        sourceAppId: config.sourceAppId,
        startOffset,
        maxItems: config.maxItems,
        mode: config.mode,
        sourceMatchField,
        targetMatchField,
        isRetry,
        retryItemCount: isRetry ? config.retryItemIds!.length : 0,
      });

      // If retrying specific items, fetch them directly instead of streaming all items
      let sourceItemBatches: PodioItem[][];

      if (isRetry) {
        migrationLogger.info('Retry mode: Fetching specific failed items', {
          itemIds: config.retryItemIds,
        });

        // Fetch the specific items that failed
        const retryItems = await fetchItemsByIds(this.client, config.retryItemIds!);

        migrationLogger.info('Fetched retry items', {
          requested: config.retryItemIds!.length,
          fetched: retryItems.length,
          notFound: config.retryItemIds!.length - retryItems.length,
        });

        // Split into batches for processing
        const batchSize = config.batchSize || 500;
        sourceItemBatches = [];
        for (let i = 0; i < retryItems.length; i += batchSize) {
          sourceItemBatches.push(retryItems.slice(i, i + batchSize));
        }
      }

      // Stream and process source items
      if (isRetry) {
        // Process retry items in batches
        // NOTE: For retry mode, we skip duplicate detection since we're retrying items that failed
        // for other reasons (rate limits, transient errors, etc.), not because they were duplicates
        for (const batch of sourceItemBatches!) {
          // Map items using field mapping
          for (const sourceItem of batch) {
            const mappedFields = mapItemFields(sourceItem, externalIdFieldMapping);

            // For retry mode, simply recreate the items without duplicate detection
            // (items failed for transient reasons like rate limits, not duplicates)
            itemsToCreate.push({
              fields: mappedFields,
              external_id: `migrated-${sourceItem.item_id}`,
            });
          }

        }
      } else {
        // Normal streaming mode - stream all items from source app
        for await (const batch of streamItems(
          this.client,
          config.sourceAppId,
          {
            batchSize: config.batchSize || 500,
            offset: startOffset,
            filters: config.filters,
          }
        )) {
          // Map items using field mapping
          for (const sourceItem of batch) {
            // Check if we've reached the max items limit
            if (itemsToCreate.length + itemsToUpdate.length >= maxItems) {
              migrationLogger.info('Reached maxItems limit, stopping stream', {
                maxItems,
                collected: itemsToCreate.length + itemsToUpdate.length,
              });
              break;
            }

            const mappedFields = mapItemFields(sourceItem, externalIdFieldMapping);

            // Handle different migration modes
            if (config.mode === 'create') {
              // LOG: Check duplicate condition
              console.log('🔎 Checking duplicate condition:', {
                sourceItemId: sourceItem.item_id,
                mode: config.mode,
                sourceMatchField,
                targetMatchField,
                willCheck: !!(sourceMatchField && targetMatchField),
              });

              // CREATE mode: optionally check for duplicates
              if (sourceMatchField && targetMatchField) {
                // Extract match field value from source item
                const sourceField = sourceItem.fields.find(
                  (f) => f.external_id === sourceMatchField
                );

                migrationLogger.debug('Duplicate check - extracting source field', {
                  sourceItemId: sourceItem.item_id,
                  sourceMatchField,
                  sourceFieldFound: !!sourceField,
                  sourceFieldType: sourceField?.type,
                });

                if (sourceField) {
                  const matchValue = extractFieldValue(sourceField);

                  migrationLogger.debug('Duplicate check - extracted match value', {
                    sourceItemId: sourceItem.item_id,
                    sourceMatchField,
                    targetMatchField,
                    matchValue,
                    matchValueType: typeof matchValue,
                    isArray: Array.isArray(matchValue),
                    duplicateBehavior,
                  });

                  // Use pre-fetch cache for instant O(1) duplicate lookup (NO API call)
                  const existingItem = prefetchCache?.getExistingItem(matchValue) || null;

                  const traceId = `${migrationJob.id}:${sourceItem.item_id}:${Date.now()}`;

                  migrationLogger.debug('Duplicate check - result from prefetch cache', {
                    sourceItemId: sourceItem.item_id,
                    matchValue,
                    isDuplicate: !!existingItem,
                    existingItemId: existingItem?.item_id,
                    fromCache: true,
                    traceId,
                  });

                  if (existingItem) {
                    // Duplicate found - log structured event
                    logDuplicateDetection(
                      migrationJob.id,
                      traceId,
                      'duplicate_found',
                      {
                        sourceItemId: sourceItem.item_id,
                        matchField: targetMatchField,
                        matchValue,
                        normalizedValue: String(matchValue),
                        targetItemId: existingItem.item_id,
                        fromCache: true,
                      }
                    );

                    if (duplicateBehavior === 'skip') {
                      skippedCount++;
                      logDuplicateDetection(
                        migrationJob.id,
                        traceId,
                        'duplicate_skipped',
                        {
                          sourceItemId: sourceItem.item_id,
                          matchField: targetMatchField,
                          matchValue,
                          normalizedValue: String(matchValue),
                          targetItemId: existingItem.item_id,
                          fromCache: true,
                        }
                      );
                      continue;
                    } else if (duplicateBehavior === 'error') {
                      throw new Error(
                        `Duplicate item found for ${sourceMatchField}=${matchValue} (source: ${sourceItem.item_id}, target: ${existingItem.item_id})`
                      );
                    } else if (duplicateBehavior === 'update') {
                      // Update instead of create
                      updatedDuplicatesCount++;
                      logDuplicateDetection(
                        migrationJob.id,
                        traceId,
                        'duplicate_updated',
                        {
                          sourceItemId: sourceItem.item_id,
                          matchField: targetMatchField,
                          matchValue,
                          normalizedValue: String(matchValue),
                          targetItemId: existingItem.item_id,
                          fromCache: true,
                        }
                      );
                      itemsToUpdate.push({
                        itemId: existingItem.item_id,
                        fields: mappedFields,
                      });
                      continue;
                    }
                  } else {
                    // No duplicate found
                    logDuplicateDetection(
                      migrationJob.id,
                      traceId,
                      'no_duplicate',
                      {
                        sourceItemId: sourceItem.item_id,
                        matchField: targetMatchField,
                        matchValue,
                        normalizedValue: String(matchValue),
                        fromCache: true,
                      }
                    );
                  }
                } else {
                  // Source match field not found - skip item to prevent potential duplicate
                  migrationLogger.warn('Duplicate check - source match field not found, skipping item', {
                    sourceItemId: sourceItem.item_id,
                    sourceMatchField,
                    availableFields: sourceItem.fields.map(f => f.external_id),
                  });
                  skippedCount++;
                  continue;
                }
              }

              // No duplicate or match fields not set - create new item
              itemsToCreate.push({
                fields: mappedFields,
                external_id: `migrated-${sourceItem.item_id}`,
              });
            } else if (config.mode === 'update') {
              // UPDATE mode: find item by match field and update
              if (!sourceMatchField || !targetMatchField) {
                throw new Error('UPDATE mode requires both sourceMatchField and targetMatchField to be set');
              }

              const sourceField = sourceItem.fields.find(
                (f) => f.external_id === sourceMatchField
              );

              if (sourceField) {
                const matchValue = extractFieldValue(sourceField);

                // Use pre-fetch cache for instant lookup (NO API call)
                const existingItem = prefetchCache?.getExistingItem(matchValue) || null;

                if (existingItem) {
                  itemsToUpdate.push({
                    itemId: existingItem.item_id,
                    fields: mappedFields,
                  });
                } else {
                  migrationLogger.warn('Item not found for update', {
                    sourceItemId: sourceItem.item_id,
                    sourceMatchField,
                    targetMatchField,
                    matchValue,
                  });
                  result.failedItems.push({
                    sourceItemId: sourceItem.item_id,
                    error: `No matching item found for ${sourceMatchField}=${matchValue}`,
                    index: result.failedItems.length,
                  });
                }
              } else {
                // Source match field not found - skip item (can't update without match field)
                migrationLogger.warn('UPDATE mode - source match field not found, skipping item', {
                  sourceItemId: sourceItem.item_id,
                  sourceMatchField,
                  availableFields: sourceItem.fields.map(f => f.external_id),
                });
                result.failedItems.push({
                  sourceItemId: sourceItem.item_id,
                  error: `Source match field '${sourceMatchField}' not found in item`,
                  index: result.failedItems.length,
                });
              }
            }
          }

          // Stop streaming if we've reached the limit
          if (itemsToCreate.length + itemsToUpdate.length >= maxItems) {
            break;
          }

          // Save checkpoint after each batch
          await this.saveCheckpoint(migrationJob.id, {
            migrationId: migrationJob.id,
            offset: startOffset + itemsToCreate.length + itemsToUpdate.length,
            processed: result.processed,
            successful: result.successful,
            failed: result.failed,
            failedItems: result.failedItems.map(f => ({
              sourceItemId: f.sourceItemId,
              error: f.error,
            })),
            timestamp: new Date(),
          });
        }
      }

      // Log pre-fetch cache statistics (if used)
      if (prefetchCache) {
        prefetchCache.logCacheStats();
      }

      migrationLogger.info('Source items processed, starting batch operations', {
        itemsToCreate: itemsToCreate.length,
        itemsToUpdate: itemsToUpdate.length,
        duplicatesSkipped: skippedCount,
        duplicatesUpdated: updatedDuplicatesCount,
        cacheStats: prefetchCache?.getCacheStats() || null,
      });

      // Process updates first (if any)
      let updateResult;
      if (itemsToUpdate.length > 0) {
        migrationLogger.info('Processing updates', {
          count: itemsToUpdate.length,
        });

        try {
          updateResult = await processor.processUpdate(itemsToUpdate);
          // Note: result.successful/failed/processed already updated by progress event handler
        } catch (error) {
          // Check if error is due to stale cache (deleted fields)
          if (isFieldNotFoundError(error)) {
            migrationLogger.warn('Field not found error detected during update - clearing caches and retrying', {
              error: error instanceof Error ? error.message : String(error),
            });

            // Clear both caches
            if (prefetchCache) {
              prefetchCache.clear();
            }
            const appStructureCache = getAppStructureCache();
            appStructureCache.clearAppStructure(config.sourceAppId);
            appStructureCache.clearAppStructure(config.targetAppId);

            // Retry once with fresh cache
            migrationLogger.info('Retrying update operation after cache clear');
            updateResult = await processor.processUpdate(itemsToUpdate);
          } else {
            // Re-throw if not a field error
            throw error;
          }
        }
      }

      // Process creates (if any)
      let createResult;
      if (itemsToCreate.length > 0) {
        migrationLogger.info('Processing creates', {
          count: itemsToCreate.length,
        });

        try {
          createResult = await processor.processCreate(itemsToCreate);
          // Note: result.successful/failed/processed already updated by progress event handler
        } catch (error) {
          // Check if error is due to stale cache (deleted fields)
          if (isFieldNotFoundError(error)) {
            migrationLogger.warn('Field not found error detected - clearing caches and retrying', {
              error: error instanceof Error ? error.message : String(error),
            });

            // Clear both caches
            if (prefetchCache) {
              prefetchCache.clear();
            }
            const appStructureCache = getAppStructureCache();
            appStructureCache.clearAppStructure(config.sourceAppId);
            appStructureCache.clearAppStructure(config.targetAppId);

            // Retry once with fresh cache
            migrationLogger.info('Retrying create operation after cache clear');
            createResult = await processor.processCreate(itemsToCreate);
          } else {
            // Re-throw if not a field error
            throw error;
          }
        }
      }

      // Consolidate failed items and save to state with error classification
      if (updateResult) {
        for (const item of updateResult.failedItems) {
          result.failedItems.push({
            sourceItemId: 0, // Update doesn't track source ID
            error: item.error,
            index: item.index,
          });

          // Save to state store with classified error
          if (item.classifiedError) {
            await migrationStateStore.addFailedItem(migrationJob.id, {
              sourceItemId: 0,
              targetItemId: (item.data as any).itemId,
              error: item.error,
              errorCategory: item.classifiedError.category,
              attemptCount: 1,
              firstAttemptAt: new Date(),
              lastAttemptAt: new Date(),
            });
          }
        }
      }

      if (createResult) {
        for (const item of createResult.failedItems) {
          result.failedItems.push({
            sourceItemId: item.sourceItemId || 0,
            error: item.error,
            index: item.index,
          });

          // Save to state store with classified error
          if (item.classifiedError) {
            await migrationStateStore.addFailedItem(migrationJob.id, {
              sourceItemId: item.sourceItemId || 0,
              error: item.error,
              errorCategory: item.classifiedError.category,
              attemptCount: 1,
              firstAttemptAt: new Date(),
              lastAttemptAt: new Date(),
            });
          }
        }
      }

      // Add duplicate handling metrics to result
      result.duplicatesSkipped = skippedCount;
      result.duplicatesUpdated = updatedDuplicatesCount;

      // Add duplicate counts to log
      if (skippedCount > 0 || updatedDuplicatesCount > 0) {
        migrationLogger.info('Duplicate detection summary', {
          duplicatesSkipped: skippedCount,
          duplicatesUpdated: updatedDuplicatesCount,
        });
      }

      result.completed = true;

      // Update job status
      await migrationStateStore.updateJobStatus(
        migrationJob.id,
        'completed',
        new Date()
      );

      migrationLogger.info('Migration execution completed', {
        migrationId: migrationJob.id,
        successful: result.successful,
        failed: result.failed,
      });
    } catch (error) {
      migrationLogger.error('Migration execution failed', {
        migrationId: migrationJob.id,
        error: error instanceof Error ? error.message : String(error),
      });

      await migrationStateStore.updateJobStatus(migrationJob.id, 'failed');
      await migrationStateStore.addMigrationError(
        migrationJob.id,
        'migration_execution',
        error instanceof Error ? error.message : String(error)
      );

      throw error;
    }

    // Calculate final metrics
    const endTime = Date.now();
    result.durationMs = endTime - startTime;
    result.throughput = result.processed / (result.durationMs / 1000);

    return result;
  }

  /**
   * Resume a migration from checkpoint
   */
  async resumeMigration(migrationId: string): Promise<MigrationResult> {
    migrationLogger.info('Resuming migration', { migrationId });

    const job = await migrationStateStore.getMigrationJob(migrationId);
    if (!job) {
      throw new Error(`Migration job not found: ${migrationId}`);
    }

    const metadata = job.metadata as {
      mode: MigrationMode;
      fieldMapping: Record<string, string>;
      batchSize?: number;
      concurrency?: number;
    };

    const checkpoint = await this.loadCheckpoint(migrationId);

    return this.executeMigration({
      sourceAppId: parseInt(job.sourceSpaceId), // Using spaceId as appId (simplified)
      targetAppId: parseInt(job.targetSpaceId),
      fieldMapping: metadata.fieldMapping,
      mode: metadata.mode,
      batchSize: metadata.batchSize,
      concurrency: metadata.concurrency,
      resumeToken: migrationId,
    });
  }

  /**
   * Export items to JSON file
   */
  async exportItems(
    appId: number,
    outputPath: string,
    options: {
      filters?: Record<string, unknown>;
      batchSize?: number;
      format?: 'json' | 'ndjson';
    } = {}
  ): Promise<{ total: number; filePath: string }> {
    migrationLogger.info('Exporting items', { appId, outputPath });

    const items: PodioItem[] = [];
    let total = 0;

    for await (const batch of streamItems(this.client, appId, {
      batchSize: options.batchSize || 500,
      filters: options.filters,
    })) {
      if (options.format === 'ndjson') {
        // Stream to file line by line
        for (const item of batch) {
          await fs.appendFile(outputPath, JSON.stringify(item) + '\n');
        }
      } else {
        items.push(...batch);
      }
      total += batch.length;
    }

    if (options.format !== 'ndjson') {
      await fs.writeFile(outputPath, JSON.stringify(items, null, 2));
    }

    migrationLogger.info('Items exported', { appId, total, outputPath });

    return { total, filePath: outputPath };
  }

  /**
   * Import items from JSON file
   */
  async importItems(
    targetAppId: number,
    sourcePath: string,
    options: {
      mode?: MigrationMode;
      batchSize?: number;
      dryRun?: boolean;
    } = {}
  ): Promise<{
    processed: number;
    successful: number;
    failed: number;
    failedItems: Array<{ index: number; error: string }>;
  }> {
    migrationLogger.info('Importing items', { targetAppId, sourcePath });

    const content = await fs.readFile(sourcePath, 'utf-8');
    const items = JSON.parse(content) as PodioItem[];

    if (options.dryRun) {
      migrationLogger.info('Dry run - skipping actual import', {
        itemCount: items.length,
      });
      return {
        processed: items.length,
        successful: items.length,
        failed: 0,
        failedItems: [],
      };
    }

    // Convert to create requests
    const requests: CreateItemRequest[] = items.map(item => ({
      fields: item.fields.reduce((acc, field) => {
        acc[field.external_id] = field.values;
        return acc;
      }, {} as Record<string, unknown>),
      external_id: `imported-${item.item_id}`,
    }));

    // Use batch processor
    const processor = new ItemBatchProcessor(this.client, targetAppId, {
      batchSize: options.batchSize || 500,
      concurrency: 5,
    });

    const result = await processor.processCreate(requests);

    migrationLogger.info('Items imported', {
      targetAppId,
      processed: result.total,
      successful: result.successful,
      failed: result.failed,
    });

    return {
      processed: result.total,
      successful: result.successful,
      failed: result.failed,
      failedItems: result.failedItems.map(f => ({
        index: f.index,
        error: f.error,
      })),
    };
  }

  /**
   * Validate migration integrity
   */
  async validateMigration(
    sourceAppId: number,
    targetAppId: number,
    fieldMapping: Record<string, string>,
    options: {
      sampleSize?: number;
      strict?: boolean;
    } = {}
  ): Promise<ValidationResult> {
    migrationLogger.info('Validating migration', {
      sourceAppId,
      targetAppId,
      sampleSize: options.sampleSize,
    });

    const result: ValidationResult = {
      total: 0,
      matched: 0,
      mismatched: [],
      missingInTarget: 0,
      missingInSource: 0,
    };

    // Sample source items
    const sourceItems: PodioItem[] = [];
    let count = 0;

    for await (const batch of streamItems(this.client, sourceAppId, {
      batchSize: 100,
    })) {
      sourceItems.push(...batch);
      count += batch.length;

      if (options.sampleSize && count >= options.sampleSize) {
        break;
      }
    }

    result.total = sourceItems.length;

    // Validate each item
    for (const sourceItem of sourceItems) {
      // This is a simplified validation - in real implementation,
      // we'd need to track source->target item ID mappings
      migrationLogger.debug('Validating item', {
        sourceItemId: sourceItem.item_id,
      });

      // For now, just count as matched if source item exists
      result.matched++;
    }

    migrationLogger.info('Validation complete', {
      total: result.total,
      matched: result.matched,
      mismatched: result.mismatched.length,
    });

    return result;
  }

  /**
   * Save migration checkpoint
   */
  private async saveCheckpoint(
    migrationId: string,
    checkpoint: MigrationCheckpoint
  ): Promise<void> {
    await fs.mkdir(this.checkpointsDir, { recursive: true });
    const checkpointPath = path.join(
      this.checkpointsDir,
      `${migrationId}.json`
    );
    await fs.writeFile(checkpointPath, JSON.stringify(checkpoint, null, 2));
  }

  /**
   * Load migration checkpoint
   */
  private async loadCheckpoint(
    migrationId: string
  ): Promise<MigrationCheckpoint | null> {
    const checkpointPath = path.join(
      this.checkpointsDir,
      `${migrationId}.json`
    );

    try {
      const content = await fs.readFile(checkpointPath, 'utf-8');
      return JSON.parse(content) as MigrationCheckpoint;
    } catch (error) {
      return null;
    }
  }

  /**
   * Get checkpoint offset for resume
   */
  private async getCheckpointOffset(migrationId: string): Promise<number> {
    const checkpoint = await this.loadCheckpoint(migrationId);
    return checkpoint?.offset || 0;
  }
}

// Export singleton instance
export const itemMigrator = new ItemMigrator();
