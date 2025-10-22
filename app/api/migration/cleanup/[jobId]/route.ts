/**
 * Cleanup Job Status API
 * - GET: Get cleanup job status
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCleanupJobStatus } from '@/lib/migration/cleanup/service';
import { CleanupJobNotFoundError } from '@/lib/migration/cleanup/errors';

export const runtime = 'nodejs';

/**
 * GET /api/migration/cleanup/:jobId
 * Get cleanup job status
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { jobId: string } }
) {
  try {
    const jobId = params.jobId;

    if (!jobId) {
      return NextResponse.json(
        {
          error: 'Invalid request',
          message: 'jobId is required',
        },
        { status: 400 }
      );
    }

    const status = await getCleanupJobStatus(jobId);

    return NextResponse.json(status, { status: 200 });
  } catch (error) {
    console.error('Failed to get cleanup job status:', error);

    // Check if it's a "not found" error
    if (error instanceof CleanupJobNotFoundError) {
      return NextResponse.json(
        {
          error: 'Not found',
          message: error.message,
        },
        { status: 404 }
      );
    }

    return NextResponse.json(
      {
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
