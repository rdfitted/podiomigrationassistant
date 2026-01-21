/**
 * Item migration service layer
 * Provides business logic for creating and managing item migration jobs
 */

import { migrationStateStore, MigrationProgress } from '../state-store';
import { ItemMigrationRequestPayload, ItemMigrationStatusResponse, FieldMapping } from './types';
import { getAppStructureDetailed } from '../../podio/migration';
import { logger } from '../logging';
import { isJobActive } from '../job-lifecycle';
import { failureLogger } from './failure-logger';
import { maskPII } from '../utils/pii-masking';
import { validateFilters } from './filter-validator';
import {
  isReadOnlyTargetFieldType,
  VALID_MATCH_FIELD_TYPES,
  INVALID_MATCH_FIELD_TYPES,
  isInvalidMatchFieldType
} from './field-mapping';

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
  if ((INVALID_MATCH_FIELD_TYPES as readonly string[]).includes(fieldType)) {
    throw new Error(
      `Invalid ${fieldRole} match field type: "${fieldLabel}" is a ${fieldType} field. ` +
      `${fieldType.charAt(0).toUpperCase() + fieldType.slice(1)} fields cannot be used for matching because ` +
      `they contain IDs or complex objects that aren't portable across apps. ` +
      `Valid match field types: ${VALID_MATCH_FIELD_TYPES.join(', ')}`
    );
  }

  if (!(VALID_MATCH_FIELD_TYPES as readonly string[]).includes(fieldType)) {
    logger.debug(`Uncommon match field type: ${fieldType}`, {
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
  logger.debug('Match field configuration', {
    sourceMatchField: request.sourceMatchField,
    targetMatchField: request.targetMatchField,
    duplicateBehavior: request.duplicateBehavior,
    hasSourceMatch: !!request.sourceMatchField,
    hasTargetMatch: !!request.targetMatchField,
    hasBoth: !!(request.sourceMatchField && request.targetMatchField),
  });

  // Check for existing active jobs with same source→target pair
  logger.info('Checking for duplicate active jobs', {
    sourceAppId: request.sourceAppId,
    targetAppId: request.targetAppId,
  });

  const allJobs = await migrationStateStore.listMigrationJobs();
  const activeStatuses = ['planning', 'in_progress'];
  const activeJobsForSameApps = allJobs.filter(job => {
    const metadata = job.metadata as { sourceAppId?: string; targetAppId?: string } | null | undefined;
    if (!metadata || typeof metadata !== 'object') {
      return false;
    }

    const isSameApps = metadata.sourceAppId === String(request.sourceAppId) &&
                       metadata.targetAppId === String(request.targetAppId);
    const isActive = activeStatuses.includes(job.status);
    return isSameApps && isActive;
  });

  if (activeJobsForSameApps.length > 0) {
    const conflictingJob = activeJobsForSameApps[0];

    // Heartbeat check only applies to in_progress jobs
    // Planning jobs are always considered active and should block duplicate creation
    const isActuallyActive =
      conflictingJob.status === 'in_progress'
        ? await isJobActive(conflictingJob.id)
        : true; // Planning jobs are always treated as active

    if (conflictingJob.status === 'in_progress' && !isActuallyActive) {
      // Conflicting job was in_progress but appears stale - attempt cleanup
      logger.warn('Found stale conflicting job, cleaning up', {
        jobId: conflictingJob.id,
        status: conflictingJob.status,
        lastHeartbeat: conflictingJob.lastHeartbeat,
      });

      try {
        // Re-fetch and re-verify before failing to avoid races
        const fresh = await migrationStateStore.getMigrationJob(conflictingJob.id);
        if (!fresh || fresh.status !== 'in_progress') {
          logger.info('Skip cleanup; conflicting job no longer in_progress', {
            jobId: conflictingJob.id,
            status: fresh?.status,
          });
        } else if (!(await isJobActive(fresh.id))) {
          await migrationStateStore.updateJobStatus(fresh.id, 'failed', new Date());
          await migrationStateStore.addMigrationError(
            fresh.id,
            'job_lifecycle',
            'Job marked as failed during duplicate detection. Job was in "in_progress" but had no recent heartbeat, indicating it was orphaned.',
            'STALE_JOB_CLEANUP'
          );
          logger.info('Successfully cleaned up stale job, proceeding with new job creation', {
            cleanedJobId: fresh.id,
          });
        } else {
          // Became active again; treat as active conflict
          const errorMessage =
            `Cannot create migration job: An active migration job (${fresh.id}) is already running ` +
            `for source app ${request.sourceAppId} → target app ${request.targetAppId}. ` +
            `Status: ${fresh.status}. ` +
            `Please wait for the existing job to complete or cancel it before starting a new one.`;

          logger.warn('Duplicate job prevention triggered - job became active again', {
            requestedSourceAppId: request.sourceAppId,
            requestedTargetAppId: request.targetAppId,
            conflictingJobId: fresh.id,
            conflictingJobStatus: fresh.status,
            lastHeartbeat: fresh.lastHeartbeat,
          });

          throw new Error(errorMessage);
        }
      } catch (cleanupError) {
        // If the error is our own thrown error, re-throw it
        if ((cleanupError as Error).message?.includes('Cannot create migration job')) {
          throw cleanupError;
        }

        logger.error('Failed to clean up stale job', {
          jobId: conflictingJob.id,
          error: cleanupError,
        });
        // Continue anyway - the error will be visible to admins
      }
    } else {
      // For planning jobs (or active in_progress), block duplicate creation
      const errorMessage =
        `Cannot create migration job: An active migration job (${conflictingJob.id}) is already running ` +
        `for source app ${request.sourceAppId} → target app ${request.targetAppId}. ` +
        `Status: ${conflictingJob.status}. ` +
        `Please wait for the existing job to complete or cancel it before starting a new one.`;

      logger.warn('Duplicate job prevention triggered - job is actively running', {
        requestedSourceAppId: request.sourceAppId,
        requestedTargetAppId: request.targetAppId,
        conflictingJobId: conflictingJob.id,
        conflictingJobStatus: conflictingJob.status,
        lastHeartbeat: conflictingJob.lastHeartbeat,
      });

      throw new Error(errorMessage);
    }
  }

  logger.info('No duplicate jobs found, proceeding with job creation');

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
    validateMatchFieldType(sourceField.type, sourceField.label || 'unknown', 'source');
    validateMatchFieldType(targetField.type, targetField.label || 'unknown', 'target');

    logger.info('Match field validation passed', {
      sourceField: { external_id: sourceField.external_id, label: sourceField.label, type: sourceField.type },
      targetField: { external_id: targetField.external_id, label: targetField.label, type: targetField.type },
    });
  }

  // Validate filters if provided
  if (request.filters) {
    const filterValidation = validateFilters(request.filters);
    if (!filterValidation.valid) {
      throw new Error(`Invalid filters: ${filterValidation.errors.join('; ')}`);
    }

    logger.info('Item migration filters validated', {
      createdFrom: request.filters.createdFrom,
      createdTo: request.filters.createdTo,
      lastEditFrom: request.filters.lastEditFrom,
      lastEditTo: request.filters.lastEditTo,
      tagCount: request.filters.tags?.length || 0,
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
      dryRun: request.dryRun,
      transferFiles: request.transferFiles,
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

  // Load failed items from log file instead of in-memory array
  const failedItems = await failureLogger.getFailedItems(jobId);

  // Calculate error statistics by category
  // Use failedItemsByCategory from progress if available (more efficient)
  const errorsByCategory: Record<string, { count: number; percentage: number; shouldRetry: boolean }> = {};

  if (job.progress?.failedItemsByCategory) {
    // Use the category counts from progress (more efficient, no need to count)
    const totalFailed = job.progress.failed || 0;
    for (const [category, count] of Object.entries(job.progress.failedItemsByCategory)) {
      if (count > 0) {
        errorsByCategory[category] = {
          count,
          percentage: totalFailed > 0 ? Math.round((count / totalFailed) * 100) : 0,
          shouldRetry: category === 'network' || category === 'rate_limit' || category === 'unknown',
        };
      }
    }
  } else if (failedItems.length > 0) {
    // Fallback: count from loaded failed items (backward compatibility)
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
    fieldMapping: metadata?.fieldMapping,
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
      error: maskPII(item.error),
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
    // Include dry-run preview if available
    dryRunPreview: metadata?.dryRunPreview || undefined,
  } as any;
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

  // Convert source field_id -> target field_id to source external_id -> target external_id
  let filteredCount = 0;
  for (const [sourceFieldId, targetFieldId] of Object.entries(fieldMapping)) {
    const sourceField = sourceApp.fields?.find(f => f.field_id.toString() === sourceFieldId);
    const targetField = targetApp.fields?.find(f => f.field_id.toString() === targetFieldId);

    if (sourceField?.external_id && targetField?.external_id) {
      // Skip if target field is read-only
      if (isReadOnlyTargetFieldType(targetField.type)) {
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
                 !isReadOnlyTargetFieldType(f.type) && // Exclude read-only target fields
                 !skipAutoMatchFieldTypes.includes(f.type) // Skip app fields
        );
        if (targetField) {
          mapping[sourceField.field_id.toString()] = targetField.field_id.toString();
          logger.debug('Mapped field by external_id', {
            sourceField: sourceField.external_id,
            sourceType: sourceField.type,
            targetField: targetField.external_id,
            targetType: targetField.type,
            crossTypeMatch: sourceField.type !== targetField.type,
          });
        } else {
          // Check if there's a match that was skipped due to read-only type
          const skippedField = targetApp.fields?.find(
            (f) => f.external_id === sourceField.external_id &&
                   isReadOnlyTargetFieldType(f.type)
          );
          if (skippedField) {
            logger.debug('Skipped read-only target field in external_id match', {
              sourceField: sourceField.external_id,
              sourceType: sourceField.type,
              targetField: skippedField.external_id,
              targetType: skippedField.type,
              reason: 'Target field is read-only (cannot be set via API)',
            });
          }
        }
      }
    }

    // Second pass: match by label for unmapped fields
    // Allow cross-type matching if both types are valid for matching
    const isCompatibleType = (type: string) =>
      (VALID_MATCH_FIELD_TYPES as readonly string[]).includes(type) &&
      !skipAutoMatchFieldTypes.includes(type);

    for (const sourceField of sourceApp.fields || []) {
      // Skip app relationship fields in auto-matching
      if (skipAutoMatchFieldTypes.includes(sourceField.type)) {
        continue;
      }

      if (!mapping[sourceField.field_id.toString()]) {
        const targetField = targetApp.fields?.find(
          (f) =>
            f.label === sourceField.label &&
            // Allow type mismatch if both are compatible types (e.g., calculation -> text)
            (f.type === sourceField.type ||
             (isCompatibleType(sourceField.type) && isCompatibleType(f.type))) &&
            !isReadOnlyTargetFieldType(f.type) && // Exclude read-only target fields
            !skipAutoMatchFieldTypes.includes(f.type) && // Skip app fields
            !Object.values(mapping).includes(f.field_id.toString())
        );
        if (targetField) {
          mapping[sourceField.field_id.toString()] = targetField.field_id.toString();
          logger.debug('Mapped field by label', {
            sourceField: sourceField.label,
            sourceType: sourceField.type,
            targetField: targetField.label,
            targetType: targetField.type,
            crossTypeMatch: sourceField.type !== targetField.type,
          });
        }
      }
    }

    const mappedCount = Object.keys(mapping).length;
    const totalSource = sourceApp.fields?.length || 0;
    const totalTarget = targetApp.fields?.length || 0;
    const writableTarget = targetApp.fields?.filter(f => !isReadOnlyTargetFieldType(f.type)).length || 0;

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

/**
 * Validation result for field mapping during retry
 */
export interface FieldMappingValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  /** Filtered mapping with read-only fields removed */
  filteredMapping?: FieldMapping;
}

interface AppStructureField {
  field_id: string | number;
  type: string;
  external_id?: string | null;
  label?: string | null;
}

interface AppStructureDetailed {
  fields?: AppStructureField[] | null;
}

/**
 * Validate a field mapping for retry operations
 * Checks that all fields exist in their respective apps and are writable
 *
 * @param fieldMapping - The field mapping to validate (source field ID -> target field ID)
 * @param sourceAppId - Source application ID
 * @param targetAppId - Target application ID
 * @returns Validation result with errors, warnings, and filtered mapping
 */
export async function validateFieldMappingForRetry(
  fieldMapping: FieldMapping,
  sourceAppId: number,
  targetAppId: number
): Promise<FieldMappingValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const filteredMapping: FieldMapping = {};

  logger.info('Validating field mapping for retry', {
    sourceAppId,
    targetAppId,
    mappingCount: Object.keys(fieldMapping).length,
  });

  try {
    // Fetch current app structures
    const sourceApp = (await getAppStructureDetailed(sourceAppId)) as AppStructureDetailed;
    const targetApp = (await getAppStructureDetailed(targetAppId)) as AppStructureDetailed;

    // Build lookup maps for faster field resolution
    const sourceFieldsById = new Map<string, AppStructureField>();
    const sourceFieldsByExternalId = new Map<string, AppStructureField>();
    for (const field of sourceApp.fields || []) {
      sourceFieldsById.set(field.field_id.toString(), field);
      if (field.external_id) {
        sourceFieldsByExternalId.set(field.external_id, field);
      }
    }

    const targetFieldsById = new Map<string, AppStructureField>();
    const targetFieldsByExternalId = new Map<string, AppStructureField>();
    for (const field of targetApp.fields || []) {
      targetFieldsById.set(field.field_id.toString(), field);
      if (field.external_id) {
        targetFieldsByExternalId.set(field.external_id, field);
      }
    }

    // Validate each mapping entry
    for (const [sourceFieldKey, targetFieldKey] of Object.entries(fieldMapping)) {
      // Try to find source field (by ID first, then by external_id)
      const sourceField = sourceFieldsById.get(sourceFieldKey) ||
                          sourceFieldsByExternalId.get(sourceFieldKey);

      // Try to find target field (by ID first, then by external_id)
      const targetField = targetFieldsById.get(targetFieldKey) ||
                          targetFieldsByExternalId.get(targetFieldKey);

      // Check if source field exists
      if (!sourceField) {
        errors.push(
          `Source field "${sourceFieldKey}" was not found in source app ${sourceAppId}. ` +
          `It may have been deleted since the original migration.`
        );
        continue;
      }

      // Check if target field exists
      if (!targetField) {
        errors.push(
          `Target field "${targetFieldKey}" was not found in target app ${targetAppId}. ` +
          `It may have been deleted since the original migration.`
        );
        continue;
      }

      // Check if target field is read-only
      if (isReadOnlyTargetFieldType(targetField.type)) {
        warnings.push(
          `Target field "${targetField.label || targetFieldKey}" (${targetField.type}) is read-only ` +
          `and will be skipped during migration. Values cannot be set directly on ${targetField.type} fields.`
        );
        continue; // Skip this mapping - don't add to filtered
      }

      // Validate field type compatibility (warning only, not blocking)
      if (sourceField.type !== targetField.type) {
        // Allow certain cross-type mappings
        const compatibleCrossTypes = [
          ['calculation', 'text'],
          ['calculation', 'number'],
          ['number', 'text'],
          ['text', 'number'],
        ];

        const isCompatible = compatibleCrossTypes.some(
          ([src, tgt]) => sourceField.type === src && targetField.type === tgt
        );

        if (!isCompatible) {
          warnings.push(
            `Field type mismatch: "${sourceField.label || sourceFieldKey}" (${sourceField.type}) ` +
            `-> "${targetField.label || targetFieldKey}" (${targetField.type}). ` +
            `Data may not transfer correctly.`
          );
        }
      }

      // Add to filtered mapping (using field IDs for consistency)
      filteredMapping[sourceField.field_id.toString()] = targetField.field_id.toString();
    }

    // Check if any valid mappings remain
    if (Object.keys(filteredMapping).length === 0 && Object.keys(fieldMapping).length > 0) {
      errors.push(
        'No valid field mappings remain after filtering. All provided mappings either reference ' +
        'non-existent fields or read-only target fields.'
      );
    }

    const valid = errors.length === 0;

    logger.info('Field mapping validation completed', {
      sourceAppId,
      targetAppId,
      valid,
      errorCount: errors.length,
      warningCount: warnings.length,
      originalMappings: Object.keys(fieldMapping).length,
      filteredMappings: Object.keys(filteredMapping).length,
    });

    return {
      valid,
      errors,
      warnings,
      filteredMapping: valid ? filteredMapping : undefined,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Failed to validate field mapping for retry', {
      sourceAppId,
      targetAppId,
      error: errorMessage,
    });

    errors.push(`Failed to validate field mapping: ${errorMessage}`);
    return {
      valid: false,
      errors,
      warnings,
    };
  }
}
