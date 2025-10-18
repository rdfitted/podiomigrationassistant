/**
 * Item Migration Job Status API - GET endpoint
 * Returns current status and progress of a migration job
 */

import { NextRequest, NextResponse } from 'next/server';
import { getItemMigrationJob } from '@/lib/migration/items/service';

export const runtime = 'nodejs';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await params;

    // Get job status
    const jobStatus = await getItemMigrationJob(jobId);

    if (!jobStatus) {
      return NextResponse.json(
        {
          error: 'Job not found',
          message: `No migration job found with ID: ${jobId}`,
        },
        { status: 404 }
      );
    }

    return NextResponse.json(jobStatus, { status: 200 });
  } catch (error) {
    console.error('Failed to get item migration job status:', error);

    return NextResponse.json(
      {
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
