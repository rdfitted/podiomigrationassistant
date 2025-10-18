/**
 * Item Migration Job Resume API - POST endpoint
 * Resumes a paused migration from its last checkpoint
 */

import { NextRequest, NextResponse } from 'next/server';
import { migrationStateStore } from '@/lib/migration/state-store';
import { startItemMigrationJob } from '@/lib/migration/items/runner';

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

    // Check if job is in a resumable state
    if (job.status !== 'paused' && job.status !== 'failed') {
      return NextResponse.json(
        {
          error: 'Cannot resume job',
          message: `Job is in '${job.status}' state and cannot be resumed. Only 'paused' or 'failed' jobs can be resumed.`,
        },
        { status: 400 }
      );
    }

    // Get the latest checkpoint
    const checkpoint = await migrationStateStore.getLatestBatchCheckpoint(jobId);

    if (!checkpoint) {
      return NextResponse.json(
        {
          error: 'No checkpoint found',
          message: 'Cannot resume migration without a checkpoint. The migration may need to be restarted.',
        },
        { status: 400 }
      );
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

    // Prepare resume config
    const resumeConfig = {
      sourceAppId: metadata.sourceAppId,
      targetAppId: metadata.targetAppId,
      batchSize: metadata.batchSize || 500,
      concurrency: metadata.concurrency || 3,
      operation: metadata.operation || 'create',
      fieldMapping: metadata.fieldMapping || {},
      duplicateCheck: metadata.duplicateCheck,
      resumeToken: jobId, // Use jobId as resume token
    };

    // Update job status to in_progress
    await migrationStateStore.updateJobStatus(jobId, 'in_progress');

    // Start migration in background (non-blocking)
    startItemMigrationJob(resumeConfig)
      .then(() => {
        console.log(`Migration ${jobId} resumed successfully`);
      })
      .catch((error) => {
        console.error(`Migration ${jobId} failed after resume:`, error);
      });

    return NextResponse.json(
      {
        success: true,
        message: 'Migration resumed successfully',
        jobId,
        checkpoint: {
          batchNumber: checkpoint.batchNumber,
          offset: checkpoint.offset,
          itemsProcessed: checkpoint.itemsProcessed,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Failed to resume migration:', error);

    return NextResponse.json(
      {
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
