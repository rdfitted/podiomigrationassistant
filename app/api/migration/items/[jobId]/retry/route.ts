/**
 * Item Migration Job Retry API - POST endpoint
 * Retries only the failed items from a migration without re-indexing
 * Supports optional field mapping updates for retry attempts
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { migrationStateStore, FieldMappingHistoryEntry } from '@/lib/migration/state-store';
import { runItemMigrationJob } from '@/lib/migration/items/runner';
import { failureLogger } from '@/lib/migration/items/failure-logger';
import { logger } from '@/lib/migration/logging';
import { validateFieldMappingForRetry } from '@/lib/migration/items/service';
import { getAppStructureCache } from '@/lib/migration/items/app-structure-cache';

export const runtime = 'nodejs';

/**
 * Type for migration job metadata used in retry operations
 * This provides type safety instead of using 'as any'
 */
interface RetryMigrationMetadata {
  sourceAppId?: string | number;
  targetAppId?: string | number;
  fieldMapping?: Record<string, string>;
  fieldMappingHistory?: FieldMappingHistoryEntry[];
  retryAttempts?: number;
  lastRetryTimestamp?: string;
  [key: string]: unknown;
}

/**
 * Regex pattern for valid Podio field IDs
 * Field IDs are numeric strings (e.g., "12345678")
 */
const FIELD_ID_PATTERN = /^\d{1,15}$/;

/**
 * Validates that a field ID matches the expected format
 */
function isValidFieldId(fieldId: string): boolean {
  return FIELD_ID_PATTERN.test(fieldId);
}

/**
 * Zod schema for retry request body
 * fieldMapping is optional - if not provided, uses original from metadata
 * Field IDs must be numeric strings to prevent injection attacks
 */
const retryRequestSchema = z.object({
  fieldMapping: z
    .record(z.string(), z.string())
    .optional()
    .refine((mapping) => !mapping || Object.keys(mapping).length > 0, {
      message: 'Field mapping cannot be empty. Omit fieldMapping to use the existing mapping.',
    })
    .refine(
      (mapping) => {
        if (!mapping) return true;
        // Validate all keys and values are valid field IDs
        return Object.entries(mapping).every(
          ([sourceId, targetId]) => isValidFieldId(sourceId) && isValidFieldId(targetId)
        );
      },
      {
        message:
          'Field mapping keys and values must be valid field IDs (numeric strings, max 15 digits)',
      }
    )
    .describe(
      'Optional updated field mapping (source field ID -> target field ID). If not provided, uses original mapping.'
    ),
});

/**
 * In-memory set of jobs currently being retried to prevent concurrent retries
 *
 * NOTE: This lock mechanism is designed for single-instance deployments.
 * In distributed/multi-instance deployments, this in-memory lock will not
 * prevent concurrent retries across different instances. For production
 * deployments with multiple instances, consider:
 * - Using Redis-based distributed locks
 * - Database-level advisory locks
 * - The job status field as an implicit lock (checked below)
 */
const retryingJobs = new Set<string>();

/**
 * Lock timeout in milliseconds - auto-release locks after this duration
 * to prevent orphaned locks from blocking retries indefinitely
 */
const RETRY_LOCK_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Map tracking when each lock was acquired for timeout-based release
 */
const retryLockTimestamps = new Map<string, number>();

/**
 * Acquire retry lock with timeout support
 * Returns true if lock was acquired, false if job is already locked
 */
function acquireRetryLock(jobId: string): boolean {
  // Check for stale lock (timeout-based release)
  const lockTime = retryLockTimestamps.get(jobId);
  if (lockTime && Date.now() - lockTime > RETRY_LOCK_TIMEOUT_MS) {
    logger.warn('Releasing stale retry lock (timeout exceeded)', {
      jobId,
      lockAgeMs: Date.now() - lockTime,
      timeoutMs: RETRY_LOCK_TIMEOUT_MS,
    });
    retryingJobs.delete(jobId);
    retryLockTimestamps.delete(jobId);
  }

  // Try to acquire lock
  if (retryingJobs.has(jobId)) {
    return false;
  }

  retryingJobs.add(jobId);
  retryLockTimestamps.set(jobId, Date.now());
  return true;
}

/**
 * Release retry lock
 */
function releaseRetryLock(jobId: string): void {
  retryingJobs.delete(jobId);
  retryLockTimestamps.delete(jobId);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
): Promise<NextResponse> {
  const { jobId } = await params;

  // TODO: Add authorization check to verify user owns or has access to the
  // source/target apps in the migration job. This is out of scope for this
  // issue but should be implemented before production deployment.
  // See: https://github.com/rdfitted/PodioAgent/issues/XX

  // Concurrency protection: prevent simultaneous retry operations on the same job
  // This uses an in-memory lock with timeout, plus job status check as implicit lock
  if (!acquireRetryLock(jobId)) {
    return NextResponse.json(
      {
        error: 'Retry in progress',
        message: `A retry operation is already in progress for job ${jobId}. Please wait for it to complete.`,
      },
      { status: 409 }
    );
  }

  const releaseAndRespond = (body: unknown, init: { status: number }) => {
    releaseRetryLock(jobId);
    return NextResponse.json(body, init);
  };

  try {
    const parsedBody = retryRequestSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsedBody.success) {
      return releaseAndRespond(
        {
          error: 'Invalid request body',
          message: 'Field mapping validation failed',
          details: parsedBody.error.errors.map((e) => ({
            path: e.path.join('.'),
            message: e.message,
          })),
        },
        { status: 400 }
      );
    }

    const requestBody = parsedBody.data;

    // Check if job exists
    const job = await migrationStateStore.getMigrationJob(jobId);

    if (!job) {
      return releaseAndRespond(
        {
          error: 'Job not found',
          message: `No migration job found with ID: ${jobId}`,
        },
        { status: 404 }
      );
    }

    // Implicit lock: check job status to prevent retrying an already in-progress job
    // This provides distributed safety when the in-memory lock doesn't help
    if (job.status === 'in_progress') {
      return releaseAndRespond(
        {
          error: 'Retry in progress',
          message: `Job ${jobId} is already in progress. Please wait for it to complete before retrying.`,
        },
        { status: 409 }
      );
    }

    // Check if there are failed items to retry
    const failedCountFromLog = await failureLogger.getFailedCount(jobId);
    const failedCount = job.progress?.failed || failedCountFromLog || 0;

    // Allow retry if either log file has items OR failed count > 0
    if (failedCount === 0) {
      return releaseAndRespond(
        {
          error: 'No failed items',
          message: 'This migration has no failed items to retry.',
        },
        { status: 400 }
      );
    }

    // Log if we have a count but no detailed items in log file
    if (failedCount > 0 && failedCountFromLog === 0) {
      logger.warn(
        'Retry requested but failures.log has no detail entries; entire migration will rerun',
        { jobId, failedCount }
      );
    }

    // Extract migration config from job metadata
    const metadata = (job.metadata || {}) as RetryMigrationMetadata;

    if (!metadata?.sourceAppId || !metadata?.targetAppId) {
      return releaseAndRespond(
        {
          error: 'Invalid job metadata',
          message: 'Job metadata is missing required fields (sourceAppId, targetAppId)',
        },
        { status: 400 }
      );
    }

    // Convert app IDs to numbers for type safety
    const sourceAppIdNum = typeof metadata.sourceAppId === 'string'
      ? parseInt(metadata.sourceAppId, 10)
      : metadata.sourceAppId;
    const targetAppIdNum = typeof metadata.targetAppId === 'string'
      ? parseInt(metadata.targetAppId, 10)
      : metadata.targetAppId;

    // Determine field mapping to use
    let fieldMappingToUse = metadata.fieldMapping;
    let fieldMappingSource: 'original' | 'user-edited' = 'original';

    if (requestBody.fieldMapping) {
      // User provided a new field mapping - validate it
      logger.info('Validating user-provided field mapping for retry', {
        jobId,
        sourceAppId: sourceAppIdNum,
        targetAppId: targetAppIdNum,
        mappingCount: Object.keys(requestBody.fieldMapping).length,
      });

      // Validate the new field mapping against current app structures
      // Note: Cache clearing happens AFTER successful validation to avoid
      // clearing cache on validation failures
      const validationResult = await validateFieldMappingForRetry(
        requestBody.fieldMapping,
        sourceAppIdNum,
        targetAppIdNum
      );

      if (!validationResult.valid) {
        return releaseAndRespond(
          {
            error: 'Invalid field mapping',
            message: 'The provided field mapping is invalid for the current app structures',
            details: validationResult.errors,
            warnings: validationResult.warnings,
          },
          { status: 400 }
        );
      }

      // Clear app structure cache AFTER successful validation
      // This ensures cache stays populated if validation fails
      const cache = getAppStructureCache();
      cache.clearAppStructure(sourceAppIdNum);
      cache.clearAppStructure(targetAppIdNum);

      // Log any warnings (non-blocking)
      if (validationResult.warnings && validationResult.warnings.length > 0) {
        logger.warn('Field mapping validation warnings', {
          jobId,
          warnings: validationResult.warnings,
        });
      }

      fieldMappingToUse = validationResult.filteredMapping || requestBody.fieldMapping;
      fieldMappingSource = 'user-edited';

      logger.info('Using user-provided field mapping for retry', {
        jobId,
        originalMappingCount: Object.keys(metadata.fieldMapping || {}).length,
        newMappingCount: Object.keys(fieldMappingToUse!).length,
        filteredFields: Object.keys(requestBody.fieldMapping).length - Object.keys(fieldMappingToUse!).length,
      });
    }

    // Update retry tracking
    const retryAttempts = (metadata.retryAttempts || 0) + 1;
    metadata.retryAttempts = retryAttempts;
    metadata.lastRetryTimestamp = new Date().toISOString();

    // Update field mapping if changed
    if (fieldMappingSource === 'user-edited') {
      // Store in fieldMappingHistory for audit trail
      if (!metadata.fieldMappingHistory) {
        // Initialize history with original mapping (use empty object if undefined)
        metadata.fieldMappingHistory = [
          {
            timestamp: job.startedAt instanceof Date ? job.startedAt.toISOString() : job.startedAt,
            mapping: metadata.fieldMapping || {},
            source: 'original' as const,
          },
        ];
      }

      // Add new mapping to history
      // Note: fieldMappingToUse is guaranteed to be defined here because we're inside
      // the user-edited branch where it was assigned from validationResult.filteredMapping
      // or requestBody.fieldMapping (both non-null at this point)
      metadata.fieldMappingHistory.push({
        timestamp: new Date().toISOString(),
        mapping: fieldMappingToUse!,
        source: 'user-edited' as const,
      });

      // Limit history to last 10 entries to prevent unbounded growth
      const MAX_HISTORY_ENTRIES = 10;
      if (metadata.fieldMappingHistory.length > MAX_HISTORY_ENTRIES) {
        // Keep the original entry (first) plus the most recent entries
        const originalEntry = metadata.fieldMappingHistory[0];
        const recentEntries = metadata.fieldMappingHistory.slice(-(MAX_HISTORY_ENTRIES - 1));
        metadata.fieldMappingHistory = [originalEntry, ...recentEntries];
        logger.debug('Trimmed field mapping history to prevent unbounded growth', {
          jobId,
          entriesKept: metadata.fieldMappingHistory.length,
          maxEntries: MAX_HISTORY_ENTRIES,
        });
      }

      // Update current field mapping
      metadata.fieldMapping = fieldMappingToUse!;
    }

    // Atomically update metadata + job status + heartbeat
    // This avoids partial updates where the mapping history is saved but status isn't (or vice versa)
    await migrationStateStore.saveMigrationJob({
      ...job,
      status: 'in_progress',
      lastHeartbeat: new Date(),
      metadata,
    });

    // Start retry in background (non-blocking)
    // The runner will pick up the failed items and updated field mapping from the job state
    runItemMigrationJob(jobId)
      .then(() => {
        logger.info('Migration retry completed successfully', { jobId });
      })
      .catch((error) => {
        logger.error('Migration retry failed', {
          jobId,
          error: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        // Remove from retrying set when done
        releaseRetryLock(jobId);
      });

    return NextResponse.json(
      {
        success: true,
        message: 'Retrying failed items',
        jobId,
        failedItemsCount: failedCount,
        retryAttempt: retryAttempts,
        fieldMappingUpdated: fieldMappingSource === 'user-edited',
      },
      { status: 202 }
    );
  } catch (error) {
    releaseRetryLock(jobId);

    logger.error('Failed to retry migration', {
      error: error instanceof Error ? error.message : String(error),
    });

    return NextResponse.json(
      {
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
