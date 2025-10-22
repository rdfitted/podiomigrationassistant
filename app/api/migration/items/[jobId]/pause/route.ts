/**
 * Item Migration Job Pause API - POST endpoint
 * Requests a graceful pause of an active migration or cleanup job
 */

import { NextRequest, NextResponse } from 'next/server';
import { pauseMigration } from '@/lib/migration/shutdown-handler';
import { migrationStateStore } from '@/lib/migration/state-store';
import { requestCleanupPause } from '@/lib/migration/cleanup/executor';

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

    // Check if job is in a pausable state (including 'detecting' and 'deleting' for cleanup jobs)
    const pausableStates = ['in_progress', 'detecting', 'deleting'];
    if (!pausableStates.includes(job.status)) {
      return NextResponse.json(
        {
          error: 'Cannot pause job',
          message: `Job is in '${job.status}' state and cannot be paused. Only jobs in 'in_progress', 'detecting', or 'deleting' state can be paused.`,
        },
        { status: 400 }
      );
    }

    // Determine job type and request pause accordingly
    const jobType = job.jobType || 'migration';

    if (jobType === 'cleanup') {
      // Request pause for cleanup job
      const paused = requestCleanupPause(jobId);

      if (!paused) {
        // Executor not found - job may not be running yet or already completed
        // Mark as paused anyway for consistency
        await migrationStateStore.updateJobStatus(jobId, 'paused');
      }

      return NextResponse.json(
        {
          success: true,
          message: 'Cleanup job pause requested successfully',
          jobId,
          jobType: 'cleanup',
        },
        { status: 200 }
      );
    } else {
      // Request graceful pause for migration job
      await pauseMigration(jobId);

      return NextResponse.json(
        {
          success: true,
          message: 'Migration paused successfully',
          jobId,
          jobType: 'migration',
        },
        { status: 200 }
      );
    }
  } catch (error) {
    console.error('Failed to pause job:', error);

    return NextResponse.json(
      {
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
