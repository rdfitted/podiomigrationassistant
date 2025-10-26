/**
 * Duplicate cleanup service layer
 * Provides business logic for detecting and cleaning up duplicate items
 */

import { migrationStateStore } from '../state-store';
import { CleanupRequestPayload, CleanupStatusResponse, CleanupResult, DuplicateGroup, DuplicateItem, CleanupMode, KeepStrategy, JobStatus } from './types';
import { getAppStructureDetailed } from '../../podio/migration';
import { logger } from '../logging';
import { normalizeForMatch } from '../items/prefetch-cache';
import { CleanupJobNotFoundError, CleanupValidationError } from './errors';
import { PodioHttpClient } from '../../podio/http/client';

/**
 * Field types that are valid for matching
 */
const VALID_MATCH_FIELD_TYPES = [
  'text',
  'number',
  'calculation',
  'email',
  'phone',
  'tel',
  'duration',
  'money',
  'location',
  'question',
];

/**
 * Field types that should NOT be used for matching
 */
const INVALID_MATCH_FIELD_TYPES = [
  'app',
  'category',
  'contact',
  'date',
  'image',
  'file',
  'embed',
  'created_on',
  'created_by',
  'created_via',
];

/**
 * Validate that a field type is suitable for matching
 */
function validateMatchFieldType(fieldType: string, fieldLabel: string): void {
  if (INVALID_MATCH_FIELD_TYPES.includes(fieldType)) {
    throw new CleanupValidationError(
      `Invalid match field type: "${fieldLabel}" is a ${fieldType} field. ` +
      `${fieldType.charAt(0).toUpperCase() + fieldType.slice(1)} fields cannot be used for matching because ` +
      `they contain IDs or complex objects that aren't portable. ` +
      `Valid match field types: ${VALID_MATCH_FIELD_TYPES.join(', ')}`
    );
  }

  if (!VALID_MATCH_FIELD_TYPES.includes(fieldType)) {
    logger.debug(`Uncommon match field type: ${fieldType}`, {
      fieldLabel,
      fieldType,
    });
  }
}

/**
 * Create a new cleanup job
 */
export async function createCleanupJob(
  request: CleanupRequestPayload
): Promise<{ jobId: string }> {
  logger.info('Creating cleanup job', {
    appId: request.appId,
    matchField: request.matchField,
    mode: request.mode,
    keepStrategy: request.keepStrategy || 'oldest',
    dryRun: request.dryRun,
  });

  // Validate match field type (required)
  if (!request.matchField) {
    throw new CleanupValidationError('matchField is required for cleanup jobs');
  }

  logger.info('Validating match field type', {
    matchField: request.matchField,
  });

  const app = await getAppStructureDetailed(request.appId);
  const matchField = app.fields?.find(f => f.external_id === request.matchField);

  if (!matchField) {
    throw new CleanupValidationError(
      `Match field not found: "${request.matchField}" does not exist in app ${request.appId}`
    );
  }

  // Validate field type is suitable for matching
  validateMatchFieldType(matchField.type, matchField.label || 'unknown');

  logger.info('Match field validation passed', {
    matchField: { external_id: matchField.external_id, label: matchField.label, type: matchField.type },
  });

  // Create cleanup job in state store
  const job = await migrationStateStore.createMigrationJob(
    String(request.appId), // Using appId as spaceId
    String(request.appId), // Same app for cleanup
    {
      jobType: 'cleanup',
      appId: request.appId,
      matchField: request.matchField,
      mode: request.mode,
      keepStrategy: request.keepStrategy || 'oldest',
      batchSize: request.batchSize || 100,
      concurrency: request.concurrency || 3,
    }
  );

  logger.info('Cleanup job created', {
    jobId: job.id,
    appId: request.appId,
  });

  return { jobId: job.id };
}

/**
 * Get cleanup job status
 */
export async function getCleanupJobStatus(jobId: string): Promise<CleanupStatusResponse> {
  const job = await migrationStateStore.getMigrationJob(jobId);

  if (!job) {
    throw new CleanupJobNotFoundError(jobId);
  }

  if (job.jobType !== 'cleanup') {
    throw new Error(`Job ${jobId} is not a cleanup job`);
  }

  // Extract cleanup-specific metadata
  const metadata = job.metadata || {};
  const mode = metadata.mode as CleanupMode || 'manual';
  const keepStrategy = metadata.keepStrategy as KeepStrategy || 'oldest';
  const duplicateGroups = metadata.duplicateGroups as DuplicateGroup[] | undefined;

  const progress = job.progress;
  const progressMetadata = progress as any; // Progress can have custom fields

  return {
    jobId: job.id,
    status: job.status as JobStatus,
    mode,
    keepStrategy,
    progress: {
      totalGroups: progress?.total || 0,
      processedGroups: progress?.processed || 0,
      totalItemsToDelete: progressMetadata?.totalItemsToDelete || 0,
      deletedItems: progress?.successful || 0,
      failedDeletions: progress?.failed || 0,
      percent: progress?.percent || 0,
      lastUpdate: progress?.lastUpdate?.toISOString() || new Date().toISOString(),
    },
    duplicateGroups,
    errors: job.errors?.map(err => ({
      itemId: (err as any).itemId ? Number((err as any).itemId) : undefined,
      message: err.message,
      code: err.code,
      timestamp: err.timestamp.toISOString(),
    })) || [],
    startedAt: job.startedAt.toISOString(),
    completedAt: job.completedAt?.toISOString(),
  };
}

/**
 * Detect duplicate groups in an app using efficient streaming with consistent normalization
 * Groups items by match field value and returns groups with duplicates
 */
export async function detectDuplicateGroups(
  client: PodioHttpClient,
  appId: number,
  matchField: string,
  options?: {
    jobId?: string;
    onPauseCheck?: () => boolean;
  }
): Promise<DuplicateGroup[]> {
  logger.info('Detecting duplicate groups with streaming', {
    appId,
    matchField,
    jobId: options?.jobId,
  });

  const startTime = Date.now();
  let itemsProcessed = 0;
  let itemsSkipped = 0;

  // Group items by normalized match value
  const groups = new Map<string, DuplicateItem[]>();
  const { streamItems } = await import('../../podio/resources/items');

  // Debug tracking
  const debugSamples: Array<{ itemId: number; raw: any; matchValue: any; normalized: string }> = [];
  const emptyFieldCount = { noField: 0, emptyValue: 0 };

  for await (const batch of streamItems(client, appId, {
    batchSize: 500,
  })) {
    // Check for pause request before processing batch
    if (options?.onPauseCheck && options.onPauseCheck()) {
      logger.info('Pause requested during duplicate detection streaming', {
        appId,
        itemsProcessed,
        jobId: options.jobId,
      });
      throw new Error('PAUSE_REQUESTED');
    }

    for (const item of batch) {
      itemsProcessed++;

      // Extract match field value
      const fieldValue = item.fields?.find((f: any) => f.external_id === matchField);
      if (!fieldValue) {
        itemsSkipped++;
        emptyFieldCount.noField++;
        continue;
      }

      // Extract the actual value from the field
      let raw = Array.isArray(fieldValue.values) && fieldValue.values.length > 0
        ? fieldValue.values[0]?.value
        : (fieldValue as any).value;

      // Unwrap nested objects (e.g., {text: ...}, {value: ...})
      const matchValue =
        typeof raw === 'object' && raw !== null
          ? (raw.text ?? raw.value ?? String(raw))
          : raw;

      // Normalize the match value using consistent logic
      const normalizedValue = normalizeForMatch(matchValue);

      // Debug: Capture first 10 samples for logging
      if (debugSamples.length < 10) {
        debugSamples.push({
          itemId: item.item_id,
          raw,
          matchValue,
          normalized: normalizedValue,
        });
      }

      // Skip empty values (null, undefined, empty string)
      if (!normalizedValue) {
        itemsSkipped++;
        emptyFieldCount.emptyValue++;
        continue;
      }

      // Add to group
      if (!groups.has(normalizedValue)) {
        groups.set(normalizedValue, []);
      }

      const duplicateItem: DuplicateItem = {
        itemId: item.item_id,
        title: (item as any).title || `Item ${item.item_id}`,
        createdOn: item.created_on,
        lastEditOn: (item as any).last_event_on || item.created_on,
        matchValue: String(matchValue),
        fieldValues: {}, // Can add preview fields here if needed
      };

      groups.get(normalizedValue)!.push(duplicateItem);
    }
  }

  // Log debug info
  logger.info('Field extraction debug samples', {
    samples: debugSamples,
    emptyFieldCount,
  });

  const duration = Date.now() - startTime;

  // Calculate normalization impact statistics
  const normalizationStats = {
    totalProcessed: itemsProcessed,
    totalSkipped: itemsSkipped,
    skippedNoField: emptyFieldCount.noField,
    skippedEmptyValue: emptyFieldCount.emptyValue,
    uniqueNormalized: groups.size,
    potentialDuplicates: itemsProcessed - itemsSkipped - groups.size,
  };

  // Log statistics
  logger.info('Duplicate detection complete', {
    itemsProcessed,
    itemsSkipped,
    uniqueValues: groups.size,
    durationMs: duration,
    itemsPerSecond: Math.round((itemsProcessed / duration) * 1000),
  });

  logger.info('Normalization impact', normalizationStats);

  // Filter to only groups with duplicates (more than 1 item)
  const duplicateGroups: DuplicateGroup[] = [];
  for (const [matchValue, groupItems] of groups) {
    if (groupItems.length > 1) {
      // Sort by creation date (oldest first), with fallback for invalid dates
      groupItems.sort((a, b) => {
        const ta = new Date(a.createdOn).getTime();
        const tb = new Date(b.createdOn).getTime();
        if (Number.isNaN(ta) && Number.isNaN(tb)) return a.itemId - b.itemId;
        if (Number.isNaN(ta)) return 1;
        if (Number.isNaN(tb)) return -1;
        return ta - tb;
      });

      duplicateGroups.push({
        matchValue,
        items: groupItems,
      });
    }
  }

  // Log top duplicate groups for debugging
  const topGroups = duplicateGroups
    .sort((a, b) => b.items.length - a.items.length)
    .slice(0, 5)
    .map(g => ({
      matchValue: g.matchValue,
      itemCount: g.items.length,
      sampleItems: g.items.slice(0, 3).map(i => ({
        itemId: i.itemId,
        title: i.title,
        matchValue: i.matchValue,
      })),
    }));

  logger.info('Duplicate detection complete', {
    totalGroups: groups.size,
    duplicateGroups: duplicateGroups.length,
    totalDuplicateItems: duplicateGroups.reduce((sum, g) => sum + g.items.length, 0),
  });

  logger.info('Top 5 duplicate groups by size', { topGroups });

  return duplicateGroups;
}

/**
 * Apply keep strategy to duplicate groups
 * Determines which item to keep and which to delete
 */
export function applyKeepStrategy(
  groups: DuplicateGroup[],
  strategy: 'oldest' | 'newest'
): DuplicateGroup[] {
  return groups.map(group => {
    const items = [...group.items];

    // Items are already sorted by creation date (oldest first) in detectDuplicateGroups
    // For 'oldest', keep first; for 'newest', keep last
    const keepIndex = strategy === 'oldest' ? 0 : items.length - 1;
    const keepItemId = items[keepIndex].itemId;

    const deleteItemIds = items
      .filter((_, idx) => idx !== keepIndex)
      .map(item => item.itemId);

    return {
      ...group,
      keepItemId,
      deleteItemIds,
    };
  });
}
