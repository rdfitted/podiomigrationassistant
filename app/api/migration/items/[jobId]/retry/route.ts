/**
 * Item Migration Job Retry API - POST endpoint
 * Retries only the failed items from a migration without re-indexing
 */

import { NextRequest, NextResponse } from 'next/server';
import { migrationStateStore } from '@/lib/migration/state-store';
import { runItemMigrationJob } from '@/lib/migration/items/runner';

export const runtime = 'nodejs';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await params;

    // Check if job exists
    const job = await migrationStateStore.getMigrationJob(jobId);

    if (!job) {
      return NextResponse.json(
        {
          error: 'Job not found',
          message: `No migration job found with ID: ${jobId}`,
        },
        { status: 404 }
      );
    }

    // Check if there are failed items to retry
    const failedItems = job.progress?.failedItems || [];
    const failedCount = job.progress?.failed || 0;

    // Allow retry if either failedItems array is populated OR failed count > 0
    // (for backward compatibility with jobs that track count but not individual items)
    if (failedItems.length === 0 && failedCount === 0) {
      return NextResponse.json(
        {
          error: 'No failed items',
          message: 'This migration has no failed items to retry.',
        },
        { status: 400 }
      );
    }

    // Log if we have a count but no detailed items
    if (failedCount > 0 && failedItems.length === 0) {
      console.warn(`Migration ${jobId} has ${failedCount} failures but no failedItems array. Retry will re-run entire migration.`);
    }

    // Extract migration config from job metadata
    const metadata = job.metadata as any;

    if (!metadata?.sourceAppId || !metadata?.targetAppId) {
      return NextResponse.json(
        {
          error: 'Invalid job metadata',
          message: 'Job metadata is missing required fields (sourceAppId, targetAppId)',
        },
        { status: 400 }
      );
    }

    // Update retry tracking
    const retryAttempts = (metadata.retryAttempts || 0) + 1;
    metadata.retryAttempts = retryAttempts;
    metadata.lastRetryTimestamp = new Date().toISOString();

    // Save updated metadata
    await migrationStateStore.saveMigrationJob({
      ...job,
      metadata,
    });

    // Update job status to in_progress
    await migrationStateStore.updateJobStatus(jobId, 'in_progress');

    // Start retry in background (non-blocking)
    // The runner will pick up the failed items from the job state
    runItemMigrationJob(jobId)
      .then(() => {
        console.log(`Migration ${jobId} retry completed successfully`);
      })
      .catch((error) => {
        console.error(`Migration ${jobId} failed during retry:`, error);
      });

    return NextResponse.json(
      {
        success: true,
        message: 'Retrying failed items',
        jobId,
        failedItemsCount: failedItems.length,
        retryAttempt: retryAttempts,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Failed to retry migration:', error);

    return NextResponse.json(
      {
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
