/**
 * Item migration service layer
 * Provides business logic for creating and managing item migration jobs
 */

import { migrationStateStore, MigrationProgress } from '../state-store';
import { ItemMigrationRequestPayload, ItemMigrationStatusResponse, ItemMigrationResult, FieldMapping } from './types';
import { getAppStructureDetailed } from '../../podio/migration';
import { logger } from '../logging';

/**
 * Field types that are valid for matching
 * These produce simple, comparable values (text, numbers, booleans)
 */
const VALID_MATCH_FIELD_TYPES = [
  'text',        // Text fields - direct string comparison
  'number',      // Number fields - numeric values
  'calculation', // Calculated fields - extracted computed value
  'email',       // Email fields - email addresses
  'phone',       // Phone fields - phone numbers
  'tel',         // Telephone fields - phone numbers (legacy)
  'duration',    // Duration fields - time values
  'money',       // Money fields - monetary values (just the number)
  'location',    // Location fields - address text
  'question',    // Question fields - yes/no boolean
];

/**
 * Field types that should NOT be used for matching
 * These produce IDs or complex objects that aren't portable
 */
const INVALID_MATCH_FIELD_TYPES = [
  'app',         // App relationship fields - item IDs (meaningless across apps)
  'category',    // Category fields - internal category IDs (not portable)
  'contact',     // Contact fields - profile/user IDs (not portable)
  'date',        // Date fields - complex objects {start, end}
  'image',       // Image fields - file IDs
  'file',        // File fields - file IDs
  'embed',       // Embed fields - URLs/embeds
  'created_on',  // System field - creation timestamp
  'created_by',  // System field - creator
  'created_via', // System field - creation method
];

/**
 * Validate that a field type is suitable for matching
 *
 * @param fieldType - Field type to validate
 * @param fieldLabel - Field label for error messages
 * @param fieldRole - 'source' or 'target' for error messages
 * @throws Error if field type is invalid for matching
 */
function validateMatchFieldType(
  fieldType: string,
  fieldLabel: string,
  fieldRole: 'source' | 'target'
): void {
  if (INVALID_MATCH_FIELD_TYPES.includes(fieldType)) {
    throw new Error(
      `Invalid ${fieldRole} match field type: "${fieldLabel}" is a ${fieldType} field. ` +
      `${fieldType.charAt(0).toUpperCase() + fieldType.slice(1)} fields cannot be used for matching because ` +
      `they contain IDs or complex objects that aren't portable across apps. ` +
      `Valid match field types: ${VALID_MATCH_FIELD_TYPES.join(', ')}`
    );
  }

  if (!VALID_MATCH_FIELD_TYPES.includes(fieldType)) {
    logger.warn(`Uncommon match field type: ${fieldType}`, {
      fieldLabel,
      fieldRole,
      fieldType,
    });
  }
}

/**
 * Create a new item migration job
 */
export async function createItemMigrationJob(
  request: ItemMigrationRequestPayload
): Promise<{ jobId: string; fieldMapping: FieldMapping }> {
  logger.info('Creating item migration job', {
    sourceAppId: request.sourceAppId,
    targetAppId: request.targetAppId,
    mode: request.mode || 'create',
    sourceMatchField: request.sourceMatchField,
    targetMatchField: request.targetMatchField,
    duplicateBehavior: request.duplicateBehavior,
  });

  // LOG: Match field configuration
  console.log('🔍 Match field configuration:', {
    sourceMatchField: request.sourceMatchField,
    targetMatchField: request.targetMatchField,
    duplicateBehavior: request.duplicateBehavior,
    hasSourceMatch: !!request.sourceMatchField,
    hasTargetMatch: !!request.targetMatchField,
    hasBoth: !!(request.sourceMatchField && request.targetMatchField),
  });

  // Validate match field types if provided
  if (request.sourceMatchField && request.targetMatchField) {
    logger.info('Validating match field types', {
      sourceMatchField: request.sourceMatchField,
      targetMatchField: request.targetMatchField,
    });

    const sourceApp = await getAppStructureDetailed(request.sourceAppId);
    const targetApp = await getAppStructureDetailed(request.targetAppId);

    const sourceField = sourceApp.fields?.find(f => f.external_id === request.sourceMatchField);
    const targetField = targetApp.fields?.find(f => f.external_id === request.targetMatchField);

    if (!sourceField) {
      throw new Error(
        `Source match field not found: "${request.sourceMatchField}" does not exist in source app ${request.sourceAppId}`
      );
    }

    if (!targetField) {
      throw new Error(
        `Target match field not found: "${request.targetMatchField}" does not exist in target app ${request.targetAppId}`
      );
    }

    // Validate field types are suitable for matching
    validateMatchFieldType(sourceField.type, sourceField.label, 'source');
    validateMatchFieldType(targetField.type, targetField.label, 'target');

    logger.info('Match field validation passed', {
      sourceField: { external_id: sourceField.external_id, label: sourceField.label, type: sourceField.type },
      targetField: { external_id: targetField.external_id, label: targetField.label, type: targetField.type },
    });
  }

  // Build field mapping if not provided
  let fieldMapping = request.fieldMapping;
  if (!fieldMapping) {
    logger.info('No field mapping provided, building default mapping');
    fieldMapping = await buildDefaultFieldMapping(request.sourceAppId, request.targetAppId);
  }

  // Create migration job in state store
  const job = await migrationStateStore.createMigrationJob(
    String(request.sourceAppId), // Using appId as spaceId for item migrations
    String(request.targetAppId),
    {
      jobType: 'item_migration',
      sourceAppId: request.sourceAppId,
      targetAppId: request.targetAppId,
      mode: request.mode || 'create',
      fieldMapping,
      sourceMatchField: request.sourceMatchField,
      targetMatchField: request.targetMatchField,
      duplicateBehavior: request.duplicateBehavior,
      batchSize: request.batchSize || 500,
      concurrency: request.concurrency || 5,
      filters: request.filters,
      stopOnError: request.stopOnError || false,
      resumeToken: request.resumeToken,
      maxItems: request.maxItems,
    }
  );

  logger.info('Item migration job created', { jobId: job.id });

  return {
    jobId: job.id,
    fieldMapping,
  };
}

/**
 * Get item migration job status
 */
export async function getItemMigrationJob(
  jobId: string
): Promise<ItemMigrationStatusResponse | null> {
  const job = await migrationStateStore.getMigrationJob(jobId);
  if (!job) {
    return null;
  }

  const metadata = job.metadata as any;

  // Calculate error statistics by category
  const errorsByCategory: Record<string, { count: number; percentage: number; shouldRetry: boolean }> = {};
  const failedItems = job.progress?.failedItems || [];

  if (failedItems.length > 0) {
    // Count by category
    const categoryCounts = new Map<string, number>();
    for (const item of failedItems) {
      const category = item.errorCategory;
      categoryCounts.set(category, (categoryCounts.get(category) || 0) + 1);
    }

    // Calculate percentages and shouldRetry flags
    const total = failedItems.length;
    for (const [category, count] of categoryCounts.entries()) {
      errorsByCategory[category] = {
        count,
        percentage: Math.round((count / total) * 100),
        shouldRetry: category === 'network' || category === 'rate_limit' || category === 'unknown',
      };
    }
  }

  return {
    jobId: job.id,
    status: job.status,
    mode: metadata.mode || 'create',
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
    resumeToken: metadata?.resumeToken,
    canResume: job.status === 'failed' && !!metadata?.resumeToken,
    startedAt: typeof job.startedAt === 'string'
      ? job.startedAt
      : job.startedAt.toISOString(),
    completedAt: job.completedAt
      ? (typeof job.completedAt === 'string'
          ? job.completedAt
          : job.completedAt.toISOString())
      : undefined,
    failedItems: failedItems.map(item => ({
      sourceItemId: item.sourceItemId,
      error: item.error,
      timestamp: typeof item.lastAttemptAt === 'string'
        ? item.lastAttemptAt
        : item.lastAttemptAt.toISOString(),
    })),
    retryAttempts: metadata?.retryAttempts || 0,
    lastRetryTimestamp: metadata?.lastRetryTimestamp,
    preRetrySnapshot: job.progress?.preRetrySnapshot
      ? {
          total: job.progress.preRetrySnapshot.total,
          processed: job.progress.preRetrySnapshot.processed,
          successful: job.progress.preRetrySnapshot.successful,
          failed: job.progress.preRetrySnapshot.failed,
          percent: job.progress.preRetrySnapshot.percent,
          lastUpdate: typeof job.progress.preRetrySnapshot.lastUpdate === 'string'
            ? job.progress.preRetrySnapshot.lastUpdate
            : job.progress.preRetrySnapshot.lastUpdate.toISOString(),
        }
      : undefined,
  };
}

/**
 * Request item migration job cancellation
 * @note Cancellation is not yet fully implemented - this is a stub
 */
export async function requestItemMigrationCancel(jobId: string): Promise<{ requested: boolean }> {
  logger.warn('Item migration cancellation requested but not implemented', { jobId });

  // TODO: Implement cancellation flag in state store
  // For now, just return that it was requested
  return { requested: true };
}

/**
 * Convert field_id-based mapping to external_id-based mapping
 * Needed because UI uses field_id but mapItemFields expects external_id
 * Automatically filters out read-only target fields that cannot be set via API
 */
export async function convertFieldMappingToExternalIds(
  fieldMapping: FieldMapping,
  sourceAppId: number,
  targetAppId: number
): Promise<FieldMapping> {
  logger.info('Converting field mapping to external IDs', { sourceAppId, targetAppId });

  const sourceApp = await getAppStructureDetailed(sourceAppId);
  const targetApp = await getAppStructureDetailed(targetAppId);

  const externalIdMapping: FieldMapping = {};

  // Read-only field types that cannot be set via API (target fields only)
  const readOnlyFieldTypes = [
    'calculation',     // Calculated/formula fields
    'created_on',      // Creation timestamp (system field)
    'created_by',      // Creator (system field)
    'created_via',     // Creation method (system field)
    'app_item_id_icon' // App item ID display field
  ];

  // Convert source field_id -> target field_id to source external_id -> target external_id
  let filteredCount = 0;
  for (const [sourceFieldId, targetFieldId] of Object.entries(fieldMapping)) {
    const sourceField = sourceApp.fields?.find(f => f.field_id.toString() === sourceFieldId);
    const targetField = targetApp.fields?.find(f => f.field_id.toString() === targetFieldId);

    if (sourceField?.external_id && targetField?.external_id) {
      // Skip if target field is read-only
      if (readOnlyFieldTypes.includes(targetField.type)) {
        logger.debug('Skipping read-only target field during mapping conversion', {
          sourceFieldId,
          sourceExternalId: sourceField.external_id,
          targetFieldId,
          targetExternalId: targetField.external_id,
          targetFieldType: targetField.type,
          targetFieldLabel: targetField.label,
        });
        filteredCount++;
        continue;
      }

      externalIdMapping[sourceField.external_id] = targetField.external_id;
    } else {
      logger.warn('Could not convert field mapping to external IDs', {
        sourceFieldId,
        targetFieldId,
        sourceExternalId: sourceField?.external_id,
        targetExternalId: targetField?.external_id,
      });
    }
  }

  logger.info('Field mapping converted', {
    originalMappings: Object.keys(fieldMapping).length,
    convertedMappings: Object.keys(externalIdMapping).length,
    filteredReadOnly: filteredCount,
  });

  return externalIdMapping;
}

/**
 * Build default field mapping between two apps
 * Maps fields by external_id first, then by label if no external_id match
 * Automatically excludes read-only target fields that cannot be set via API
 * Automatically excludes app relationship fields to prevent unintended app-to-app references
 */
export async function buildDefaultFieldMapping(
  sourceAppId: number,
  targetAppId: number
): Promise<FieldMapping> {
  logger.info('Building default field mapping', { sourceAppId, targetAppId });

  try {
    const sourceApp = await getAppStructureDetailed(sourceAppId);
    const targetApp = await getAppStructureDetailed(targetAppId);

    const mapping: FieldMapping = {};

    // Read-only field types that cannot be set via API (target fields only)
    const readOnlyFieldTypes = [
      'calculation',     // Calculated/formula fields
      'created_on',      // Creation timestamp (system field)
      'created_by',      // Creator (system field)
      'created_via',     // Creation method (system field)
      'app_item_id_icon' // App item ID display field
    ];

    // Field types to skip in auto-matching
    const skipAutoMatchFieldTypes = [
      'app' // App relationship fields - skip to prevent unintended app-to-app references
    ];

    // First pass: match by external_id
    for (const sourceField of sourceApp.fields || []) {
      // Skip app relationship fields in auto-matching
      if (skipAutoMatchFieldTypes.includes(sourceField.type)) {
        logger.debug('Skipping app relationship field in auto-match', {
          sourceField: sourceField.external_id || sourceField.label,
          type: sourceField.type,
        });
        continue;
      }

      if (sourceField.external_id) {
        const targetField = targetApp.fields?.find(
          (f) => f.external_id === sourceField.external_id &&
                 !readOnlyFieldTypes.includes(f.type) && // Exclude read-only target fields
                 !skipAutoMatchFieldTypes.includes(f.type) // Skip app fields
        );
        if (targetField) {
          mapping[sourceField.field_id.toString()] = targetField.field_id.toString();
          logger.debug('Mapped field by external_id', {
            sourceField: sourceField.external_id,
            targetField: targetField.external_id,
            type: targetField.type,
          });
        }
      }
    }

    // Second pass: match by label for unmapped fields
    for (const sourceField of sourceApp.fields || []) {
      // Skip app relationship fields in auto-matching
      if (skipAutoMatchFieldTypes.includes(sourceField.type)) {
        continue;
      }

      if (!mapping[sourceField.field_id.toString()]) {
        const targetField = targetApp.fields?.find(
          (f) =>
            f.label === sourceField.label &&
            f.type === sourceField.type &&
            !readOnlyFieldTypes.includes(f.type) && // Exclude read-only target fields
            !skipAutoMatchFieldTypes.includes(f.type) && // Skip app fields
            !Object.values(mapping).includes(f.field_id.toString())
        );
        if (targetField) {
          mapping[sourceField.field_id.toString()] = targetField.field_id.toString();
          logger.debug('Mapped field by label', {
            sourceField: sourceField.label,
            targetField: targetField.label,
            type: targetField.type,
          });
        }
      }
    }

    const mappedCount = Object.keys(mapping).length;
    const totalSource = sourceApp.fields?.length || 0;
    const totalTarget = targetApp.fields?.length || 0;
    const writableTarget = targetApp.fields?.filter(f => !readOnlyFieldTypes.includes(f.type)).length || 0;

    logger.info('Field mapping built', {
      sourceFields: totalSource,
      targetFields: totalTarget,
      writableTargetFields: writableTarget,
      mapped: mappedCount,
    });

    return mapping;
  } catch (error) {
    logger.error('Failed to build field mapping', { sourceAppId, targetAppId, error });
    throw error;
  }
}

/**
 * Update migration job progress
 * Called by the migration executor to update progress
 */
export async function updateMigrationProgress(
  jobId: string,
  progress: MigrationProgress
): Promise<void> {
  await migrationStateStore.updateJobProgress(jobId, progress);
}
