/**
 * Execute Cleanup API
 * - POST: Execute cleanup with approved groups (for manual mode)
 */

import { NextRequest, NextResponse } from 'next/server';
import { executeCleanup } from '@/lib/migration/cleanup/executor';
import { DuplicateGroup } from '@/lib/migration/cleanup/types';
import { loadPodioConfig } from '@/lib/podio/config';
import { getPodioHttpClient } from '@/lib/podio/http/client';
import { migrationStateStore } from '@/lib/migration/state-store';

export const runtime = 'nodejs';

/**
 * POST /api/migration/cleanup/:jobId/execute
 * Execute cleanup with approved groups
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await params;

    if (!jobId) {
      return NextResponse.json(
        {
          error: 'Invalid request',
          message: 'jobId is required',
        },
        { status: 400 }
      );
    }

    // Get the job to retrieve its configuration
    const job = await migrationStateStore.getMigrationJob(jobId);

    if (!job) {
      return NextResponse.json(
        {
          error: 'Not found',
          message: `Cleanup job not found: ${jobId}`,
        },
        { status: 404 }
      );
    }

    if (job.jobType !== 'cleanup') {
      return NextResponse.json(
        {
          error: 'Invalid request',
          message: `Job ${jobId} is not a cleanup job`,
        },
        { status: 400 }
      );
    }

    // Parse request body (approved groups)
    const body = await request.json();
    const approvedGroups = body.approvedGroups as DuplicateGroup[];

    if (!approvedGroups || !Array.isArray(approvedGroups)) {
      return NextResponse.json(
        {
          error: 'Invalid request',
          message: 'approvedGroups is required and must be an array',
        },
        { status: 400 }
      );
    }

    console.log('📥 Execute cleanup - Request received:', {
      jobId,
      approvedGroupsCount: approvedGroups.length,
    });

    // Check Podio configuration
    try {
      loadPodioConfig();
    } catch (configError) {
      return NextResponse.json(
        {
          error: 'Podio not configured',
          message: 'Please configure Podio credentials in .env.local',
        },
        { status: 503 }
      );
    }

    const client = getPodioHttpClient();

    // Build request payload from job metadata and approved groups
    const jobMetadata = job.metadata as any;
    const cleanupRequest = {
      appId: jobMetadata.appId,
      matchField: jobMetadata.matchField,
      mode: jobMetadata.mode,
      keepStrategy: jobMetadata.keepStrategy,
      batchSize: jobMetadata.batchSize,
      concurrency: jobMetadata.concurrency,
      dryRun: false,
      approvedGroups,
    };

    // Execute cleanup in background
    executeCleanup(client, jobId, cleanupRequest).catch((error) => {
      console.error('Cleanup execution failed:', error);
    });

    return NextResponse.json(
      {
        jobId,
        status: 'Cleanup execution started',
      },
      { status: 202 } // 202 Accepted
    );
  } catch (error) {
    console.error('Failed to execute cleanup:', error);

    return NextResponse.json(
      {
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
