/**
 * Delete items API route
 * POST /api/delete/items - Create a new delete job
 */

import { NextRequest, NextResponse } from 'next/server';
import { createDeleteJob } from '@/lib/migration/items/delete-service';
import { runDeleteJob } from '@/lib/migration/items/delete-runner';
import { DeleteJobRequestPayload } from '@/lib/migration/items/types';
import { logger } from '@/lib/migration/logging';

export async function POST(request: NextRequest) {
  try {
    const payload: DeleteJobRequestPayload = await request.json();

    logger.info('Delete job requested', {
      appId: payload.appId,
      filters: payload.filters,
      maxItems: payload.maxItems,
    });

    // Validate required fields
    if (!payload.appId) {
      return NextResponse.json(
        { error: 'Missing required field: appId' },
        { status: 400 }
      );
    }

    // Create delete job
    const { jobId } = await createDeleteJob(payload);

    // Start execution in background
    runDeleteJob(jobId).catch((error) => {
      logger.error('Delete job execution failed', {
        jobId,
        error: error instanceof Error ? error.message : String(error),
      });
    });

    return NextResponse.json({ jobId }, { status: 201 });
  } catch (error) {
    logger.error('Failed to create delete job', {
      error: error instanceof Error ? error.message : String(error),
    });

    return NextResponse.json(
      {
        error: 'Failed to create delete job',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
