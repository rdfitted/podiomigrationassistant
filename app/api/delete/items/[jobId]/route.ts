/**
 * Delete job status API route
 * GET /api/delete/items/:jobId - Get delete job status
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDeleteJob } from '@/lib/migration/items/delete-service';
import { logger } from '@/lib/migration/logging';

export async function GET(
  request: NextRequest,
  { params }: { params: { jobId: string } }
) {
  try {
    const { jobId } = params;

    logger.debug('Fetching delete job status', { jobId });

    const job = await getDeleteJob(jobId);

    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    return NextResponse.json(job);
  } catch (error) {
    logger.error('Failed to fetch delete job status', {
      jobId: params.jobId,
      error: error instanceof Error ? error.message : String(error),
    });

    return NextResponse.json(
      {
        error: 'Failed to fetch delete job status',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
