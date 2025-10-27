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
  createItem,
  deleteItem,
} from '../../podio/resources/items';
import { ItemBatchProcessor, BatchProcessorConfig } from './batch-processor';
import { migrationStateStore, MigrationJob } from '../state-store';
import { logger as migrationLogger, logMigrationEvent, logDuplicateDetection } from '../logging';
import { convertFieldMappingToExternalIds } from './service';
import {
  PrefetchCache,
  normalizeForMatch,
  PrefetchHealthCheckError,
  PrefetchRunStats,
  PrefetchTimeoutError,
} from './prefetch-cache';
import { getAppStructureCache } from './app-structure-cache';
import { isFieldNotFoundError } from '../../podio/errors';
import { getMigrationLogger, removeMigrationLogger, MigrationFileLogger } from '../file-logger';
import { UpdateStatsTracker } from './update-stats-tracker';
import { maskPII } from '../utils/pii-masking';
import { failureLogger } from './failure-logger';

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
  /** Dry-run mode: preview changes without executing (CREATE, UPDATE, UPSERT) */
  dryRun?: boolean;
  /** Whether to transfer files from source to destination (UPDATE/UPSERT modes only, default: false) */
  transferFiles?: boolean;
  /** Progress callback */
  onProgress?: (progress: { total: number; processed: number; successful: number; failed: number }) => void | Promise<void>;
  /** Optional override for target prefetch timeout (ms). Default: 4 hours */
  prefetchTimeoutMs?: number;
  /** Optional override for prefetch health check interval (ms). Default: 5 minutes */
  prefetchHealthCheckIntervalMs?: number;
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
  /** Dry-run preview (only present when dryRun=true) */
  dryRunPreview?: DryRunPreview;
}

const DRY_RUN_STUB_CREATED_ON = new Date(0).toISOString();

function createDryRunTargetStub(itemId: number, targetAppId: number): PodioItem {
  return {
    item_id: itemId,
    app_item_id: itemId,
    app: {
      app_id: targetAppId,
      config: {
        name: 'dry-run-stub',
      },
    },
    fields: [],
    created_on: DRY_RUN_STUB_CREATED_ON,
    created_by: {
      user_id: 0,
      name: 'dry-run-stub',
    },
    link: '',
    rights: [],
  } as PodioItem;
}

/**
 * Field change preview for dry-run mode
 */
export interface FieldChange {
  /** Field external ID */
  fieldExternalId: string;
  /** Field label (human-readable name) */
  fieldLabel?: string;
  /** Current value in target item */
  currentValue: unknown;
  /** New value from source item */
  newValue: unknown;
  /** Whether values are different */
  willChange: boolean;
}

/**
 * Update preview for a single item (dry-run mode)
 */
export interface UpdatePreview {
  /** Source item ID */
  sourceItemId: number;
  /** Target item ID that would be updated */
  targetItemId: number;
  /** Match field value used to find this item */
  matchValue: unknown;
  /** Fields that would change */
  changes: FieldChange[];
  /** Total number of fields that would change */
  changeCount: number;
}

/**
 * Dry-run preview result
 */
export interface CreatePreview {
  sourceItemId: number;
  matchValue: unknown | null;
  fields: Array<{
    fieldExternalId: string;
    fieldLabel?: string;
    value: unknown;
  }>;
  fieldCount: number;
}

export interface DryRunPreview {
  mode: 'create' | 'update' | 'upsert';
  /** Items that would be created (CREATE mode) */
  wouldCreate?: CreatePreview[];
  /** Items that would be successfully updated (UPDATE/UPSERT modes) */
  wouldUpdate?: UpdatePreview[];
  /** Items that would fail (no match found or duplicate error) */
  wouldFail: Array<{
    sourceItemId: number;
    matchValue?: unknown;
    reason: string;
  }>;
  /** Items that would be skipped (no changes detected or duplicate skip) */
  wouldSkip: Array<{
    sourceItemId: number;
    targetItemId?: number | null;
    matchValue?: unknown;
    reason: string;
  }>;
  /** Summary statistics */
  summary: {
    totalSourceItems: number;
    wouldCreateCount?: number;
    wouldUpdateCount?: number;
    wouldFailCount: number;
    wouldSkipCount: number;
    totalFieldChanges?: number;
  };
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
   * Fetch first N items from source app for validation testing
   *
   * @param appId - App ID to fetch items from
   * @param count - Number of items to fetch
   * @param filters - Optional filters to apply (same as used in migration)
   */
  private async fetchFirstNItems(
    appId: number,
    count: number,
    filters?: Record<string, unknown>
  ): Promise<PodioItem[]> {
    migrationLogger.info('Fetching first N items for validation', { appId, count, filters });

    const items: PodioItem[] = [];

    for await (const batch of streamItems(this.client, appId, {
      batchSize: count,
      filters
    })) {
      items.push(...batch.slice(0, count - items.length));
      if (items.length >= count) break;
    }

    migrationLogger.info('Fetched items for validation', {
      appId,
      requested: count,
      fetched: items.length,
      filtersApplied: !!filters,
    });

    return items;
  }

  /**
   * Validate field mapping by creating test items
   * Tests with first 3 source items to ensure mappings work
   *
   * @returns Validation result with success status and any errors
   */
  async validateFieldMapping(config: MigrationConfig): Promise<{
    valid: boolean;
    error?: string;
    testedItems: number;
    successfulCreates: number;
    failedCreates: number;
    testItemIds: number[];
  }> {
    migrationLogger.info('Starting field mapping validation', {
      sourceAppId: config.sourceAppId,
      targetAppId: config.targetAppId,
      hasFilters: !!config.filters,
    });

    // Step 1: Fetch first 3 items from source app (with same filters as migration)
    const testSourceItems = await this.fetchFirstNItems(
      config.sourceAppId,
      3,
      config.filters
    );

    if (testSourceItems.length === 0) {
      return {
        valid: false,
        error: 'Source app is empty - no items to migrate',
        testedItems: 0,
        successfulCreates: 0,
        failedCreates: 0,
        testItemIds: [],
      };
    }

    const testItemIds: number[] = [];
    const errors: string[] = [];
    let successCount = 0;

    // Step 2: Convert field mapping to external IDs
    const externalIdFieldMapping = await convertFieldMappingToExternalIds(
      config.fieldMapping,
      config.sourceAppId,
      config.targetAppId
    );

    // Step 3: Try to create each test item
    for (const [index, sourceItem] of testSourceItems.entries()) {
      try {
        migrationLogger.info(`Testing item ${index + 1}/${testSourceItems.length}`, {
          sourceItemId: sourceItem.item_id,
        });

        // Map fields
        const mappedFields = mapItemFields(sourceItem, externalIdFieldMapping);

        // Attempt create
        const response = await createItem(
          this.client,
          config.targetAppId,
          {
            fields: mappedFields,
            external_id: `validation-test-${Date.now()}-${index}`,
          },
          {
            hook: false,  // Don't trigger webhooks for test
            silent: true, // Don't send notifications
          }
        );

        testItemIds.push(response.item_id);
        successCount++;

        migrationLogger.info(`Test item ${index + 1} created successfully`, {
          sourceItemId: sourceItem.item_id,
          testItemId: response.item_id,
        });

      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        errors.push(`Item ${index + 1} (ID: ${sourceItem.item_id}): ${errorMsg}`);

        migrationLogger.error(`Test item ${index + 1} failed`, {
          sourceItemId: sourceItem.item_id,
          error: errorMsg,
        });
      }
    }

    // Step 4: Clean up - delete test items
    if (testItemIds.length > 0) {
      migrationLogger.info('Cleaning up test items', {
        count: testItemIds.length,
      });

      for (const itemId of testItemIds) {
        try {
          await deleteItem(this.client, itemId);
          migrationLogger.debug('Test item deleted', { itemId });
        } catch (error) {
          // CRITICAL: If we can't delete test items, abort migration
          const errorMsg = error instanceof Error ? error.message : String(error);
          migrationLogger.error('Failed to delete test item - ABORTING', {
            itemId,
            error: errorMsg,
          });

          return {
            valid: false,
            error: `Failed to delete test item ${itemId}: ${errorMsg}. Please manually delete test items before retrying.`,
            testedItems: testSourceItems.length,
            successfulCreates: successCount,
            failedCreates: errors.length,
            testItemIds,
          };
        }
      }

      migrationLogger.info('All test items deleted successfully');
    }

    // Step 5: Return validation result
    if (errors.length > 0) {
      return {
        valid: false,
        error: `Field mapping validation failed:\n${errors.join('\n')}`,
        testedItems: testSourceItems.length,
        successfulCreates: successCount,
        failedCreates: errors.length,
        testItemIds: [],
      };
    }

    return {
      valid: true,
      testedItems: testSourceItems.length,
      successfulCreates: successCount,
      failedCreates: 0,
      testItemIds: [],
    };
  }

  /**
   * Compare two field values to determine if they're different
   * Uses deep equality for objects and arrays
   */
  private compareFieldValues(value1: unknown, value2: unknown): boolean {
    // Normalize both values for comparison
    const normalized1 = normalizeForMatch(value1);
    const normalized2 = normalizeForMatch(value2);

    // If both normalize to empty, they're equal
    if (normalized1 === '' && normalized2 === '') {
      return false; // No change
    }

    // Compare normalized values
    return normalized1 !== normalized2;
  }

  /**
   * Generate update preview for a single item (dry-run mode)
   * Compares source item fields with target item fields to detect changes
   */
  private async generateUpdatePreview(
    sourceItem: PodioItem,
    targetItem: PodioItem,
    mappedFields: Record<string, unknown>,
    externalIdFieldMapping: Record<string, string>,
    matchValue: unknown
  ): Promise<UpdatePreview> {
    const changes: FieldChange[] = [];

    // Get target app structure for field labels
    const appStructureCache = getAppStructureCache();
    const targetApp = await appStructureCache.getAppStructure(targetItem.app.app_id);

    // For each mapped field, compare current vs new value
    for (const [targetExternalId, newValue] of Object.entries(mappedFields)) {
      // Find current value in target item
      const targetField = targetItem.fields.find(f => f.external_id === targetExternalId);
      const currentValue = targetField ? extractFieldValue(targetField) : null;

      // Find field label
      const targetFieldDef = targetApp.fields?.find(f => f.external_id === targetExternalId);
      const fieldLabel = targetFieldDef?.label || targetExternalId;

      // Compare values
      const willChange = this.compareFieldValues(currentValue, newValue);

      changes.push({
        fieldExternalId: targetExternalId,
        fieldLabel,
        currentValue,
        newValue,
        willChange,
      });
    }

    // Count how many fields will actually change
    const changeCount = changes.filter(c => c.willChange).length;

    return {
      sourceItemId: sourceItem.item_id,
      targetItemId: targetItem.item_id,
      matchValue,
      changes,
      changeCount,
    };
  }

  /**
   * Hydrate target items for dry-run previews by fetching full Podio items.
   */
  private async fetchDryRunTargetItems(targetItemIds: number[]): Promise<Map<number, PodioItem>> {
    const uniqueIds = Array.from(new Set(targetItemIds)).filter(
      (id): id is number => typeof id === 'number' && !Number.isNaN(id)
    );

    if (uniqueIds.length === 0) {
      return new Map();
    }

    try {
      const fetchedItems = await fetchItemsByIds(this.client, uniqueIds);
      return new Map(fetchedItems.map(item => [item.item_id, item]));
    } catch (error) {
      migrationLogger.warn('Failed to hydrate dry-run target items, falling back to stubs', {
        error: error instanceof Error ? error.message : String(error),
        requestedIds: uniqueIds.length,
      });
      return new Map();
    }
  }

  /**
   * Generate a preview for a CREATE operation
   */
  private async generateCreatePreview(
    sourceItem: PodioItem,
    mappedFields: Record<string, unknown>,
    matchValue: unknown | null,
    targetAppId: number
  ): Promise<CreatePreview> {
    const fields: Array<{
      fieldExternalId: string;
      fieldLabel?: string;
      value: unknown;
    }> = [];

    // Get target app structure for field labels
    const appStructureCache = getAppStructureCache();
    const targetApp = await appStructureCache.getAppStructure(targetAppId);

    // For each mapped field, add to preview
    for (const [targetExternalId, value] of Object.entries(mappedFields)) {
      // Find field label
      const targetFieldDef = targetApp.fields?.find(f => f.external_id === targetExternalId);
      const fieldLabel = targetFieldDef?.label || targetExternalId;

      fields.push({
        fieldExternalId: targetExternalId,
        fieldLabel,
        value,
      });
    }

    return {
      sourceItemId: sourceItem.item_id,
      matchValue,
      fields,
      fieldCount: fields.length,
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
      dryRun: config.dryRun,
      transferFiles: config.transferFiles,
    });

    // Dry-run mode is now supported for all operations (CREATE, UPDATE, UPSERT)
    if (config.dryRun) {
      migrationLogger.info('Dry-run mode enabled - no items will be created or updated', {
        mode: config.mode,
      });
    }

    // ONLY validate for CREATE mode when not in dry-run
    // (validation creates/deletes test items, which violates dry-run contract)
    if (config.mode === 'create' && !config.dryRun) {
      migrationLogger.info('Validating field mapping before migration');

      const validationResult = await this.validateFieldMapping(config);

      if (!validationResult.valid) {
        // Validation failed - throw error immediately
        throw new Error(
          `Field mapping validation failed:\n\n${validationResult.error}\n\n` +
          `Please check your field mappings and ensure field types are compatible.\n` +
          `Tested ${validationResult.testedItems} items: ` +
          `${validationResult.successfulCreates} succeeded, ${validationResult.failedCreates} failed.`
        );
      }

      migrationLogger.info('Field mapping validation passed', {
        testedItems: validationResult.testedItems,
        successfulCreates: validationResult.successfulCreates,
      });
    }

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

    // Initialize file logger for UPDATE mode (critical for diagnostics)
    let fileLogger: MigrationFileLogger | null = null;
    let updateStatsTracker: UpdateStatsTracker | null = null;

    if (config.mode === 'update' || config.mode === 'upsert') {
      migrationLogger.info('Initializing UPDATE mode file logger', {
        migrationId: migrationJob.id,
        mode: config.mode,
      });

      fileLogger = await getMigrationLogger(migrationJob.id);
      updateStatsTracker = new UpdateStatsTracker(migrationJob.id, fileLogger);

      await fileLogger.logMigration('INFO', 'update_mode_migration_started', {
        migrationId: migrationJob.id,
        mode: config.mode,
        sourceAppId: config.sourceAppId,
        targetAppId: config.targetAppId,
        sourceMatchField: config.sourceMatchField,
        targetMatchField: config.targetMatchField,
        dryRun: config.dryRun,
        transferFiles: config.transferFiles,
      });
    }

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

      // Create batch processor (pass logger and stats tracker for UPDATE mode)
      const processor = new ItemBatchProcessor(
        this.client,
        config.targetAppId,
        {
          batchSize: config.batchSize || 500,
          concurrency: config.concurrency || 5,
          maxRetries: 3,
          stopOnError: config.stopOnError || false,
          transferFiles: config.transferFiles || false,
        },
        fileLogger || undefined,
        updateStatsTracker || undefined
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
      migrationLogger.debug('Migrator config received', {
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
      const itemsToUpdate: Array<{ itemId: number; fields: Record<string, unknown>; sourceItemId?: number }> = [];

      // Dry-run mode: track additional info for preview
      const dryRunUpdateInfo: Array<{
        sourceItem: PodioItem;
        targetItemId: number;
        matchValue: unknown;
        fields: Record<string, unknown>;
      }> = [];
      const dryRunCreateInfo: Array<{
        sourceItem: PodioItem;
        matchValue: unknown | null;
        fields: Record<string, unknown>;
      }> = [];
      const dryRunFailedMatches: Array<{
        sourceItemId: number;
        matchValue: unknown;
        reason: string;
      }> = [];
      const dryRunSkippedItems: Array<{
        sourceItemId: number;
        targetItemId: number | null;
        matchValue: unknown;
        reason: string;
      }> = [];

      let skippedCount = 0;
      let updatedDuplicatesCount = 0;
      const maxItems = config.maxItems || Infinity;
      let maxItemsReached = false; // Flag to signal outer loop to stop

      // Determine if this is a retry operation FIRST
      const isRetry = config.retryItemIds && config.retryItemIds.length > 0;

      // Validate: UPDATE mode does not support retry operations
      if (isRetry && config.mode === 'update') {
        throw new Error('Retry mode is not supported for UPDATE operations. UPDATE mode requires matching existing items, which cannot be retried.');
      }

      // Initialize pre-fetch cache if duplicate checking is enabled
      // BUT skip it in retry mode (we don't need duplicate detection for retries)
      let prefetchCache: PrefetchCache | null = null;
      if (!isRetry && sourceMatchField && targetMatchField) {
        prefetchCache = new PrefetchCache();
        migrationLogger.info('Starting pre-fetch of target items', {
          targetAppId: config.targetAppId,
          matchField: targetMatchField,
        });

        const prefetchStartTime = Date.now();
        try {
          const prefetchStats: PrefetchRunStats = await prefetchCache.prefetchTargetItems(
            this.client,
            config.targetAppId,
            targetMatchField,
            fileLogger || undefined,  // Pass logger for UPDATE mode logging
            config.prefetchTimeoutMs,
            config.prefetchHealthCheckIntervalMs
          );

          // ADDED: Enhanced logging with cache statistics
          const cacheStats = prefetchCache.getCacheStats();
          migrationLogger.info('Pre-fetch complete', {
            targetAppId: config.targetAppId,
            matchField: targetMatchField,
            cachedItems: prefetchCache.size(),
            stats: prefetchStats,
            cacheStats: {
              uniqueKeys: cacheStats.uniqueKeys,
              totalItems: cacheStats.totalItems,
              hits: cacheStats.hits,
              misses: cacheStats.misses,
            },
          });

          // Record prefetch stats in UPDATE stats tracker
          if (updateStatsTracker) {
            updateStatsTracker.recordPrefetchComplete(prefetchStats);
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          const isTimeout = error instanceof PrefetchTimeoutError;
          const isHealthCheck = error instanceof PrefetchHealthCheckError;

          migrationLogger.error('Pre-fetch failed - migration cannot continue', {
            targetAppId: config.targetAppId,
            matchField: targetMatchField,
            error: errorMessage,
            isTimeout,
            isHealthCheck,
            elapsedMs: Date.now() - prefetchStartTime,
          });

          // Enrich error message with context
          let enrichedMessage = `Prefetch failed for target app ${config.targetAppId}: ${errorMessage}`;

          if (isTimeout) {
            enrichedMessage += '\n\nThis migration requires prefetching all target items to prevent duplicates, but the operation timed out. ';
            enrichedMessage += 'Possible solutions:\n';
            enrichedMessage += '  1. Check network connectivity and API availability\n';
            enrichedMessage += '  2. The target app may be very large - contact support for assistance\n';
            enrichedMessage += '  3. Try again during off-peak hours when API performance is better';
          } else if (isHealthCheck) {
            enrichedMessage += '\n\nThe prefetch operation stalled (no progress detected). ';
            enrichedMessage += 'This usually indicates:\n';
            enrichedMessage += '  1. Network connectivity issues\n';
            enrichedMessage += '  2. Podio API unavailability or rate limiting\n';
            enrichedMessage += '  3. App permissions may have changed\n';
            enrichedMessage += 'Please check your network connection and try again.';
          }

          const cause = error instanceof Error ? error : new Error(errorMessage);
          throw new Error(enrichedMessage, { cause });
        }
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

      // Set total items in stats tracker if retry mode
      if (updateStatsTracker && isRetry && config.retryItemIds) {
        updateStatsTracker.setTotalItems(config.retryItemIds.length);
      }

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
          // Check for pause request before processing each batch
          if (config.onProgress) {
            await config.onProgress({
              total: config.retryItemIds!.length,
              processed: itemsToCreate.length,
              successful: 0,
              failed: 0,
            });
          }

          // Map items using field mapping
          for (const sourceItem of batch) {
            // Check if we've reached the max items limit (retry mode)
            if (itemsToCreate.length >= maxItems) {
              migrationLogger.info('Reached maxItems limit in retry mode, stopping', {
                maxItems,
                collected: itemsToCreate.length,
              });
              maxItemsReached = true; // Set flag to stop outer loop
              break;
            }

            const mappedFields = mapItemFields(sourceItem, externalIdFieldMapping);

            // For retry mode, simply recreate the items without duplicate detection
            // (items failed for transient reasons like rate limits, not duplicates)
            itemsToCreate.push({
              fields: mappedFields,
              external_id: `migrated-${sourceItem.item_id}`,
            });
          }

          // Stop processing retry batches if we've reached the limit
          if (maxItemsReached) {
            migrationLogger.info('Stopping retry mode - maxItems limit reached', {
              maxItems,
              collected: itemsToCreate.length,
            });
            break;
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
          // Check for pause request before processing each batch
          if (config.onProgress) {
            await config.onProgress({
              total: itemsToCreate.length + itemsToUpdate.length + batch.length,
              processed: itemsToCreate.length + itemsToUpdate.length,
              successful: 0,
              failed: 0,
            });
          }

          // Map items using field mapping
          for (const sourceItem of batch) {
            // Check if we've reached the max items limit
            if (itemsToCreate.length + itemsToUpdate.length >= maxItems) {
              migrationLogger.info('Reached maxItems limit, stopping stream', {
                maxItems,
                collected: itemsToCreate.length + itemsToUpdate.length,
              });
              maxItemsReached = true; // Set flag to stop outer loop
              break;
            }

            const mappedFields = mapItemFields(sourceItem, externalIdFieldMapping);

            // Handle different migration modes
            // UPSERT mode is treated like CREATE with effective duplicate behavior = 'update'
            if (config.mode === 'create' || config.mode === 'upsert') {
              // Determine effective duplicate behavior (UPSERT always updates duplicates)
              const effectiveDuplicateBehavior: DuplicateBehavior =
                config.mode === 'upsert' ? 'update' : (duplicateBehavior || 'skip');

              // LOG: Check duplicate condition
              migrationLogger.debug('Checking duplicate condition', {
                sourceItemId: sourceItem.item_id,
                mode: config.mode,
                sourceMatchField,
                targetMatchField,
                duplicateBehavior,
                effectiveDuplicateBehavior,
                willCheck: !!(sourceMatchField && targetMatchField),
              });

              // CREATE/UPSERT mode: optionally check for duplicates
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
                  const normalizedMatchValue = normalizeForMatch(matchValue);
                  const maskedMatchValue = maskPII(matchValue);
                  const maskedNormalizedMatchValue = maskPII(normalizedMatchValue);

                  migrationLogger.debug('Duplicate check - extracted match value', {
                    sourceItemId: sourceItem.item_id,
                    sourceMatchField,
                    targetMatchField,
                    matchValue: maskedMatchValue,
                    matchValueType: typeof matchValue,
                    isArray: Array.isArray(matchValue),
                    duplicateBehavior,
                    effectiveDuplicateBehavior,
                  });

                  // Use pre-fetch cache for instant O(1) duplicate lookup (NO API call)
                  // Use getExistingItemId() for memory efficiency (avoids storing full PodioItems)
                  const existingItemId = prefetchCache?.getExistingItemId(matchValue) || null;

                  const traceId = `${migrationJob.id}:${sourceItem.item_id}:${Date.now()}`;

                  migrationLogger.debug('Duplicate check - result from prefetch cache', {
                    sourceItemId: sourceItem.item_id,
                    matchValue: maskedMatchValue,
                    isDuplicate: !!existingItemId,
                    existingItemId,
                    fromCache: true,
                    traceId,
                  });

                  if (existingItemId) {
                    // Duplicate found - log structured event
                    logDuplicateDetection(
                      migrationJob.id,
                      traceId,
                      'duplicate_found',
                      {
                        sourceItemId: sourceItem.item_id,
                        matchField: targetMatchField,
                        matchValue: maskedMatchValue,
                        normalizedValue: maskedNormalizedMatchValue,
                        targetItemId: existingItemId,
                        fromCache: true,
                      }
                    );

                    if (effectiveDuplicateBehavior === 'skip') {
                      skippedCount++;
                      logDuplicateDetection(
                        migrationJob.id,
                        traceId,
                        'duplicate_skipped',
                        {
                          sourceItemId: sourceItem.item_id,
                          matchField: targetMatchField,
                          matchValue: maskedMatchValue,
                          normalizedValue: maskedNormalizedMatchValue,
                          targetItemId: existingItemId,
                          fromCache: true,
                        }
                      );

                      // Dry-run mode: capture skipped item info
                      if (config.dryRun) {
                        dryRunSkippedItems.push({
                          sourceItemId: sourceItem.item_id,
                          targetItemId: existingItemId,
                          matchValue,
                          reason: `Duplicate found for ${sourceMatchField}=${matchValue} - would be skipped`,
                        });
                      }
                      continue;
                    } else if (effectiveDuplicateBehavior === 'error') {
                      // Dry-run mode: track as would-fail instead of throwing
                      if (config.dryRun) {
                        dryRunFailedMatches.push({
                          sourceItemId: sourceItem.item_id,
                          matchValue,
                          reason: `Duplicate found for ${sourceMatchField}=${matchValue} - would fail with error`,
                        });
                        continue;
                      } else {
                        throw new Error(
                          `Duplicate item found for ${sourceMatchField}=${maskedMatchValue} (source: ${sourceItem.item_id}, target: ${existingItemId})`
                        );
                      }
                    } else if (effectiveDuplicateBehavior === 'update') {
                      // Update instead of create
                      updatedDuplicatesCount++;
                      logDuplicateDetection(
                        migrationJob.id,
                        traceId,
                        'duplicate_updated',
                        {
                          sourceItemId: sourceItem.item_id,
                          matchField: targetMatchField,
                          matchValue: maskedMatchValue,
                          normalizedValue: maskedNormalizedMatchValue,
                          targetItemId: existingItemId,
                          fromCache: true,
                        }
                      );
                      itemsToUpdate.push({
                        itemId: existingItemId,
                        fields: mappedFields,
                        sourceItemId: sourceItem.item_id, // Track source item ID for error reporting
                      });

                      // Dry-run mode: capture duplicate-update info
                      if (config.dryRun) {
                        dryRunUpdateInfo.push({
                          sourceItem,
                          targetItemId: existingItemId,
                          matchValue,
                          fields: mappedFields,
                        });
                      }
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
                        matchValue: maskedMatchValue,
                        normalizedValue: maskedNormalizedMatchValue,
                        fromCache: true,
                      }
                    );

                    // ADDED: Extra debug log for troubleshooting match failures
                    migrationLogger.debug('No duplicate found - match details', {
                      sourceItemId: sourceItem.item_id,
                      sourceMatchField,
                      targetMatchField,
                      rawMatchValue: maskedMatchValue,
                      matchValueType: typeof matchValue,
                      isArray: Array.isArray(matchValue),
                      isEmpty: normalizedMatchValue === '',
                      normalizedValue: maskedNormalizedMatchValue,
                      cacheSize: prefetchCache?.size() || 0,
                    });
                  }
                } else {
                  // Source match field not found - skip item to prevent potential duplicate
                  migrationLogger.warn('Duplicate check - source match field not found, skipping item', {
                    sourceItemId: sourceItem.item_id,
                    sourceMatchField,
                    availableFields: sourceItem.fields.map(f => f.external_id),
                  });

                  // Dry-run mode: capture skipped item info
                  if (config.dryRun) {
                    dryRunSkippedItems.push({
                      sourceItemId: sourceItem.item_id,
                      targetItemId: null,
                      matchValue: null,
                      reason: `Source match field '${sourceMatchField}' not found in item - would be skipped`,
                    });
                  }

                  skippedCount++;
                  continue;
                }
              }

              // No duplicate or match fields not set - create new item
              itemsToCreate.push({
                fields: mappedFields,
                external_id: `migrated-${sourceItem.item_id}`,
              });

              // Dry-run mode: capture create info
              if (config.dryRun) {
                // Extract match value if match fields are set
                let capturedMatchValue: unknown | null = null;
                if (sourceMatchField) {
                  const sourceField = sourceItem.fields.find(
                    (f) => f.external_id === sourceMatchField
                  );
                  if (sourceField) {
                    capturedMatchValue = extractFieldValue(sourceField);
                  }
                }

                dryRunCreateInfo.push({
                  sourceItem,
                  matchValue: capturedMatchValue,
                  fields: mappedFields,
                });
              }
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
                const normalizedKey = normalizeForMatch(matchValue);

                // Log match lookup attempt (fire-and-forget for performance)
                if (fileLogger) {
                  void fileLogger.logMatch('DEBUG', 'update_match_lookup', {
                    sourceItemId: sourceItem.item_id,
                    matchField: sourceMatchField,
                    matchValue: maskPII(matchValue),
                    normalizedKey: maskPII(normalizedKey),
                  });
                }

                // Use pre-fetch cache for instant lookup (NO API call)
                // Use getExistingItemId() for memory efficiency (avoids storing full PodioItems)
                const existingItemId = prefetchCache?.getExistingItemId(matchValue) || null;

                if (existingItemId) {
                  // Match found - cache hit (log fire-and-forget for performance)
                  if (fileLogger) {
                    void fileLogger.logMatch('INFO', 'update_match_found', {
                      sourceItemId: sourceItem.item_id,
                      matchField: sourceMatchField,
                      matchValue: maskPII(matchValue),
                      targetItemId: existingItemId,
                    });
                  }

                  // Record match hit in stats tracker
                  if (updateStatsTracker) {
                    updateStatsTracker.recordMatchLookup(true);
                  }

                  itemsToUpdate.push({
                    itemId: existingItemId,
                    fields: mappedFields,
                    sourceItemId: sourceItem.item_id, // Track source item ID for error reporting
                  });

                  // Dry-run mode: capture additional info for preview
                  if (config.dryRun) {
                    dryRunUpdateInfo.push({
                      sourceItem,
                      targetItemId: existingItemId,
                      matchValue,
                      fields: mappedFields,
                    });
                  }
                } else {
                  // Match not found - cache miss
                  migrationLogger.warn('Item not found for update', {
                    sourceItemId: sourceItem.item_id,
                    sourceMatchField,
                    targetMatchField,
                    matchValue: maskPII(matchValue),
                  });

                  // Get current cache stats for diagnostics
                  const cacheStats = prefetchCache?.getCacheStats();

                  // Log match failure with cache statistics (fire-and-forget for performance)
                  if (fileLogger) {
                    void fileLogger.logMatch('WARN', 'update_match_not_found', {
                      sourceItemId: sourceItem.item_id,
                      matchField: sourceMatchField,
                      matchValue: maskPII(matchValue),
                      normalizedKey: maskPII(normalizedKey),
                      cacheSize: prefetchCache?.size() || 0,
                      cacheHits: cacheStats?.hits || 0,
                      cacheMisses: cacheStats?.misses || 0,
                      hitRate: cacheStats?.hitRate ? Math.round(cacheStats.hitRate * 100) : 0,
                    });

                    // Log to failures.log as well (fire-and-forget for performance)
                    void fileLogger.logFailure('update_match_failed', {
                      sourceItemId: sourceItem.item_id,
                      matchField: sourceMatchField,
                      matchValue: maskPII(matchValue),
                      normalizedKey: maskPII(normalizedKey),
                      reason: 'No matching item found in target app',
                      suggestion: 'Item may not exist in target, or match field value may differ',
                    });
                  }

                  // Record match miss in stats tracker
                  if (updateStatsTracker) {
                    updateStatsTracker.recordMatchLookup(false);
                  }

                  // Track failed match
                  const failedMatch = {
                    sourceItemId: sourceItem.item_id,
                    error: `No matching item found for ${sourceMatchField}=${matchValue}`,
                    index: result.failedItems.length,
                  };
                  result.failedItems.push(failedMatch);

                  // Save to state store and log file (non-dry-run only)
                  if (!config.dryRun) {
                    const failedItemDetail = {
                      sourceItemId: sourceItem.item_id,
                      targetItemId: undefined,
                      error: `No matching item found for ${sourceMatchField}=${matchValue}`,
                      errorCategory: 'validation' as const,
                      attemptCount: 1,
                      firstAttemptAt: new Date(),
                      lastAttemptAt: new Date(),
                    };

                    // Increment counter in state store
                    await migrationStateStore.incrementFailedItemCount(migrationJob.id, 'validation');

                    // Log full details to failures.log
                    await failureLogger.logFailedItem(migrationJob.id, failedItemDetail);
                  }

                  // Dry-run mode: capture failed match info
                  if (config.dryRun) {
                    dryRunFailedMatches.push({
                      sourceItemId: sourceItem.item_id,
                      matchValue,
                      reason: `No matching item found for ${sourceMatchField}=${matchValue}`,
                    });
                  }
                }
              } else {
                // Source match field not found - skip item (can't update without match field)
                migrationLogger.warn('UPDATE mode - source match field not found, skipping item', {
                  sourceItemId: sourceItem.item_id,
                  sourceMatchField,
                  availableFields: sourceItem.fields.map(f => f.external_id),
                });

                // Log source field missing (fire-and-forget for performance)
                if (fileLogger) {
                  void fileLogger.logMatch('WARN', 'update_source_field_missing', {
                    sourceItemId: sourceItem.item_id,
                    expectedField: sourceMatchField,
                    availableFields: sourceItem.fields.map(f => f.external_id),
                  });

                  // Log to failures.log as well (fire-and-forget for performance)
                  void fileLogger.logFailure('update_source_field_missing', {
                    sourceItemId: sourceItem.item_id,
                    expectedField: sourceMatchField,
                    availableFields: sourceItem.fields.map(f => f.external_id),
                    reason: 'Source match field not found in source item',
                    suggestion: 'Check that source app has the expected match field',
                  });
                }

                // Record as match miss in stats tracker
                if (updateStatsTracker) {
                  updateStatsTracker.recordMatchLookup(false);
                }

                const failedMatch = {
                  sourceItemId: sourceItem.item_id,
                  error: `Source match field '${sourceMatchField}' not found in item`,
                  index: result.failedItems.length,
                };
                result.failedItems.push(failedMatch);

                // Save to state store and log file (non-dry-run only)
                if (!config.dryRun) {
                  const failedItemDetail = {
                    sourceItemId: sourceItem.item_id,
                    targetItemId: undefined,
                    error: `Source match field '${sourceMatchField}' not found in item`,
                    errorCategory: 'validation' as const,
                    attemptCount: 1,
                    firstAttemptAt: new Date(),
                    lastAttemptAt: new Date(),
                  };

                  // Increment counter in state store
                  await migrationStateStore.incrementFailedItemCount(migrationJob.id, 'validation');

                  // Log full details to failures.log
                  await failureLogger.logFailedItem(migrationJob.id, failedItemDetail);
                }

                // Dry-run mode: capture failed match info
                if (config.dryRun) {
                  dryRunFailedMatches.push({
                    sourceItemId: sourceItem.item_id,
                    matchValue: null,
                    reason: `Source match field '${sourceMatchField}' not found in item`,
                  });
                }
              }
            }
          }

          // Stop streaming if we've reached the limit
          if (maxItemsReached) {
            migrationLogger.info('Stopping outer loop - maxItems limit reached', {
              maxItems,
              collected: itemsToCreate.length + itemsToUpdate.length,
            });
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

      // Provide total items for stats in UPDATE/UPSERT non-dry-run flows
      if (updateStatsTracker && (config.mode === 'update' || config.mode === 'upsert') && !config.dryRun) {
        updateStatsTracker.setTotalItems(itemsToUpdate.length);
      }

      // Validate: Check for items in wrong arrays for the mode (defensive check)
      if (config.mode === 'update' && itemsToCreate.length > 0) {
        migrationLogger.warn('UPDATE mode has items in itemsToCreate array - this should not happen', {
          mode: config.mode,
          itemsToCreate: itemsToCreate.length,
          itemsToUpdate: itemsToUpdate.length,
        });
      }
      if (config.mode === 'create' && itemsToUpdate.length > 0) {
        migrationLogger.warn('CREATE mode has items in itemsToUpdate array - this should not happen', {
          mode: config.mode,
          itemsToCreate: itemsToCreate.length,
          itemsToUpdate: itemsToUpdate.length,
        });
      }

      // Process updates first (if any)
      // NOTE: Only UPDATE and UPSERT modes should update items. CREATE mode should never update.
      let updateResult;
      if (itemsToUpdate.length > 0 && (config.mode === 'update' || config.mode === 'upsert')) {
        // DRY-RUN MODE: Generate preview instead of executing updates (applies to all modes)
        if (config.dryRun) {
          migrationLogger.info('Dry-run mode: Generating update preview', {
            count: itemsToUpdate.length,
          });

          // Generate preview for each update
          const updatePreviews: UpdatePreview[] = [];
          const skippedPreviews: DryRunPreview['wouldSkip'] = [];

          const hydratedTargetItems = await this.fetchDryRunTargetItems(
            dryRunUpdateInfo.map(info => info.targetItemId)
          );

          for (const updateInfo of dryRunUpdateInfo) {
            const targetItem =
              hydratedTargetItems.get(updateInfo.targetItemId) ||
              createDryRunTargetStub(updateInfo.targetItemId, config.targetAppId);

            const preview = await this.generateUpdatePreview(
              updateInfo.sourceItem,
              targetItem,
              updateInfo.fields,
              externalIdFieldMapping,
              updateInfo.matchValue
            );

            // Skip items with no changes
            if (preview.changeCount === 0) {
              skippedPreviews.push({
                sourceItemId: preview.sourceItemId,
                targetItemId: preview.targetItemId,
                matchValue: updateInfo.matchValue,
                reason: 'No field changes detected - values are identical',
              });
            } else {
              updatePreviews.push(preview);
            }
          }

          // Build dry-run preview result
          const dryRunPreview: DryRunPreview = {
            mode: config.mode,
            wouldUpdate: updatePreviews,
            wouldFail: dryRunFailedMatches,
            wouldSkip: skippedPreviews,
            summary: {
              totalSourceItems: dryRunUpdateInfo.length + dryRunFailedMatches.length,
              wouldUpdateCount: updatePreviews.length,
              wouldFailCount: dryRunFailedMatches.length,
              wouldSkipCount: skippedPreviews.length,
              totalFieldChanges: updatePreviews.reduce((sum, p) => sum + p.changeCount, 0),
            },
          };

          result.dryRunPreview = dryRunPreview;

          // In dry-run mode, mark everything as successful (no actual execution)
          result.successful = updatePreviews.length;
          result.processed = dryRunUpdateInfo.length + dryRunFailedMatches.length;

          migrationLogger.info('Dry-run preview generated', {
            wouldUpdate: updatePreviews.length,
            wouldFail: dryRunFailedMatches.length,
            wouldSkip: skippedPreviews.length,
            totalFieldChanges: dryRunPreview.summary.totalFieldChanges,
          });
        } else {
          // NORMAL MODE: Execute updates
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
      }

      // Process creates (if any)
      // NOTE: Only CREATE and UPSERT modes should create items. UPDATE mode should never create.
      let createResult;
      if (itemsToCreate.length > 0 && (config.mode === 'create' || config.mode === 'upsert')) {
        // DRY-RUN MODE: Generate preview instead of executing creates (applies to all modes)
        if (config.dryRun) {
          migrationLogger.info('Dry-run mode: Generating create preview', {
            count: itemsToCreate.length,
          });

          // Generate preview for each create
          const createPreviews: CreatePreview[] = [];

          for (const createInfo of dryRunCreateInfo) {
            const preview = await this.generateCreatePreview(
              createInfo.sourceItem,
              createInfo.fields,
              createInfo.matchValue,
              config.targetAppId
            );
            createPreviews.push(preview);
          }

          // Build dry-run preview result for CREATE mode
          // For UPSERT mode, merge with existing update preview if present
          if (config.mode === 'upsert' && result.dryRunPreview) {
            // Merge create preview into existing update preview
            const existingPreview = result.dryRunPreview;
            result.dryRunPreview = {
              mode: config.mode,
              wouldCreate: createPreviews,
              wouldUpdate: existingPreview.wouldUpdate,
              wouldFail: dryRunFailedMatches,
              wouldSkip: [...(existingPreview.wouldSkip || []), ...dryRunSkippedItems],
              summary: {
                totalSourceItems: dryRunCreateInfo.length + dryRunSkippedItems.length + (existingPreview.summary.totalSourceItems || 0),
                wouldCreateCount: createPreviews.length,
                wouldUpdateCount: existingPreview.summary.wouldUpdateCount,
                wouldFailCount: dryRunFailedMatches.length,
                wouldSkipCount: (existingPreview.summary.wouldSkipCount || 0) + dryRunSkippedItems.length,
                totalFieldChanges: existingPreview.summary.totalFieldChanges,
              },
            };
          } else {
            // CREATE mode only - new preview
            const dryRunPreview: DryRunPreview = {
              mode: config.mode,
              wouldCreate: createPreviews,
              wouldFail: dryRunFailedMatches,
              wouldSkip: dryRunSkippedItems,
              summary: {
                totalSourceItems: dryRunCreateInfo.length + dryRunFailedMatches.length + dryRunSkippedItems.length,
                wouldCreateCount: createPreviews.length,
                wouldFailCount: dryRunFailedMatches.length,
                wouldSkipCount: dryRunSkippedItems.length,
              },
            };
            result.dryRunPreview = dryRunPreview;
          }

          // In dry-run mode, mark everything as successful (no actual execution)
          // For UPSERT, include both creates and updates in success count
          if (config.mode === 'upsert' && result.dryRunPreview) {
            result.successful = createPreviews.length + (result.dryRunPreview.summary.wouldUpdateCount || 0);
            result.processed = result.dryRunPreview.summary.totalSourceItems;

            migrationLogger.info('Dry-run preview generated (UPSERT)', {
              wouldCreate: createPreviews.length,
              wouldUpdate: result.dryRunPreview.summary.wouldUpdateCount,
              wouldFail: dryRunFailedMatches.length,
              wouldSkip: result.dryRunPreview.summary.wouldSkipCount,
              totalFieldChanges: result.dryRunPreview.summary.totalFieldChanges,
            });
          } else {
            result.successful = createPreviews.length;
            result.processed = dryRunCreateInfo.length + dryRunFailedMatches.length + dryRunSkippedItems.length;

            migrationLogger.info('Dry-run preview generated (CREATE)', {
              wouldCreate: createPreviews.length,
              wouldFail: dryRunFailedMatches.length,
              wouldSkip: dryRunSkippedItems.length,
            });
          }
        } else {
          // NORMAL MODE: Execute creates
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
      }

      // Consolidate failed items and save to state with error classification
      if (updateResult) {
        for (const item of updateResult.failedItems) {
          result.failedItems.push({
            sourceItemId: item.sourceItemId || 0, // Now tracked from batch processor
            error: item.error,
            index: item.index,
          });

          // Save to state store and log file with classified error
          if (item.classifiedError) {
            const failedItemDetail = {
              sourceItemId: item.sourceItemId || 0, // Now tracked from batch processor
              targetItemId: (item.data as any).itemId,
              error: item.error,
              errorCategory: item.classifiedError.category,
              attemptCount: 1,
              firstAttemptAt: new Date(),
              lastAttemptAt: new Date(),
            };

            // Increment counter in state store
            await migrationStateStore.incrementFailedItemCount(migrationJob.id, item.classifiedError.category);

            // Log full details to failures.log
            await failureLogger.logFailedItem(migrationJob.id, failedItemDetail);
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

          // Save to state store and log file with classified error
          if (item.classifiedError) {
            const failedItemDetail = {
              sourceItemId: item.sourceItemId || 0,
              error: item.error,
              errorCategory: item.classifiedError.category,
              attemptCount: 1,
              firstAttemptAt: new Date(),
              lastAttemptAt: new Date(),
            };

            // Increment counter in state store
            await migrationStateStore.incrementFailedItemCount(migrationJob.id, item.classifiedError.category);

            // Log full details to failures.log
            await failureLogger.logFailedItem(migrationJob.id, failedItemDetail);
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

      // Log final UPDATE mode statistics
      if (updateStatsTracker) {
        updateStatsTracker.logFinalStats();
      }

      // Log final completion for UPDATE mode
      if (fileLogger && (config.mode === 'update' || config.mode === 'upsert')) {
        await fileLogger.logMigration('INFO', 'update_mode_migration_completed', {
          migrationId: migrationJob.id,
          mode: config.mode,
          successful: result.successful,
          failed: result.failed,
          processed: result.processed,
          durationMs: Date.now() - startTime,
        });

        // Clean up logger resources (close streams and stop timers)
        await removeMigrationLogger(migrationJob.id);
      }

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

      // Clean up logger resources on error (best-effort, don't throw)
      if (fileLogger) {
        try {
          await removeMigrationLogger(migrationJob.id);
        } catch {
          // Swallow cleanup errors - migration already failed
        }
      }

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
