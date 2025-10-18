/**
 * Item Migration Job Pause API - POST endpoint
 * Requests a graceful pause of an active migration
 */

import { NextRequest, NextResponse } from 'next/server';
import { pauseMigration } from '@/lib/migration/shutdown-handler';
import { migrationStateStore } from '@/lib/migration/state-store';

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

    // Check if job is in a pausable state
    if (job.status !== 'in_progress') {
      return NextResponse.json(
        {
          error: 'Cannot pause job',
          message: `Job is in '${job.status}' state and cannot be paused. Only 'in_progress' jobs can be paused.`,
        },
        { status: 400 }
      );
    }

    // Request graceful pause
    await pauseMigration(jobId);

    return NextResponse.json(
      {
        success: true,
        message: 'Migration paused successfully',
        jobId,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Failed to pause migration:', error);

    return NextResponse.json(
      {
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
