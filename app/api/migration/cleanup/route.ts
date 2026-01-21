/**
 * Duplicate Cleanup API
 * - GET: List all cleanup jobs
 * - POST: Create new cleanup job
 */

import { NextRequest, NextResponse } from 'next/server';
import { createCleanupJob, getCleanupJobStatus } from '@/lib/migration/cleanup/service';
import { CleanupRequestPayload } from '@/lib/migration/cleanup/types';
import { loadPodioConfig } from '@/lib/podio/config';
import { migrationStateStore } from '@/lib/migration/state-store';
import { executeCleanup } from '@/lib/migration/cleanup/executor';
import { getPodioHttpClient } from '@/lib/podio/http/client';

export const runtime = 'nodejs';

/**
 * GET /api/migration/cleanup
 * List all cleanup jobs
 */
export async function GET() {
  try {
    const jobs = await migrationStateStore.listMigrationJobs();

    // Filter to only cleanup jobs and sort by start time (newest first)
    const cleanupJobs = jobs
      .filter((job) => job.jobType === 'cleanup')
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
      .map((job) => ({
        id: job.id,
        status: job.status,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
        progress: job.progress,
        metadata: job.metadata,
      }));

    return NextResponse.json(
      {
        cleanupJobs,
        total: cleanupJobs.length,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Failed to list cleanup jobs:', error);

    return NextResponse.json(
      {
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/migration/cleanup
 * Create new cleanup job
 */
export async function POST(request: NextRequest) {
  try {
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

    // Parse request body
    const body = (await request.json()) as CleanupRequestPayload;

    // Normalize filters - ensure backwards compatibility with clients that don't send filters
    // Convert empty objects or undefined to undefined for consistent handling
    const normalizedFilters = body.filters && Object.keys(body.filters).length > 0
      ? body.filters
      : undefined;

    console.log('📥 Cleanup API - Request received:', {
      appId: body.appId,
      matchField: body.matchField,
      mode: body.mode,
      keepStrategy: body.keepStrategy,
      dryRun: body.dryRun,
      maxGroups: body.maxGroups,
      filters: normalizedFilters,
    });

    // Update body with normalized filters
    body.filters = normalizedFilters;

    // Validate required fields
    if (!body.appId || !body.matchField) {
      return NextResponse.json(
        {
          error: 'Invalid request',
          message: 'appId and matchField are required',
        },
        { status: 400 }
      );
    }

    if (!body.mode || !['manual', 'automated'].includes(body.mode)) {
      return NextResponse.json(
        {
          error: 'Invalid request',
          message: 'mode must be either "manual" or "automated"',
        },
        { status: 400 }
      );
    }

    // Create cleanup job
    const { jobId } = await createCleanupJob(body);

    // Start background job execution (non-blocking)
    const client = getPodioHttpClient();

    executeCleanup(client, jobId, body).catch(async (error) => {
      console.error('Background cleanup execution failed:', error);
      // Update job status to failed so polling clients can detect the failure
      try {
        await migrationStateStore.updateJobStatus(jobId, 'failed', error.message);
      } catch (updateError) {
        console.error('Failed to update job status to failed:', updateError);
      }
    });

    // Return job ID immediately
    return NextResponse.json(
      {
        jobId,
        status: 'Job created and started',
      },
      { status: 202 } // 202 Accepted
    );
  } catch (error) {
    console.error('Failed to create cleanup job:', error);

    return NextResponse.json(
      {
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
