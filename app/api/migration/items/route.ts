/**
 * Item Migration API
 * - GET: List all migration jobs
 * - POST: Create new item migration jobs
 */

import { NextRequest, NextResponse } from 'next/server';
import { createItemMigrationJob } from '@/lib/migration/items/service';
import { runItemMigrationJob } from '@/lib/migration/items/runner';
import { ItemMigrationRequestPayload } from '@/lib/migration/items/types';
import { loadPodioConfig } from '@/lib/podio/config';
import { migrationStateStore } from '@/lib/migration/state-store';

export const runtime = 'nodejs';

/**
 * GET /api/migration/items
 * List all migration jobs with pagination
 * Query params:
 * - limit: number of migrations to return (default: 10)
 * - skip: number of migrations to skip (default: 0)
 */
export async function GET(request: NextRequest) {
  try {
    // Parse query params
    const searchParams = request.nextUrl.searchParams;
    const limit = parseInt(searchParams.get('limit') || '10');
    const skip = parseInt(searchParams.get('skip') || '0');

    const jobs = await migrationStateStore.listMigrationJobs();

    // Filter to only item migrations and sort by start time (newest first)
    // Check both job.jobType (future-proof) and job.metadata.jobType (current)
    // Also include jobs without jobType for backwards compatibility
    const itemMigrations = jobs
      .filter((job) =>
        job.jobType === 'item_migration' ||
        (job.metadata as any)?.jobType === 'item_migration' ||
        (!job.jobType && !(job.metadata as any)?.jobType)
      )
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());

    // Apply pagination
    const total = itemMigrations.length;
    const paginatedMigrations = itemMigrations
      .slice(skip, skip + limit)
      .map((job) => ({
        id: job.id,
        status: job.status,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
        sourceSpaceId: job.sourceSpaceId,
        targetSpaceId: job.targetSpaceId,
        progress: job.progress,
        metadata: job.metadata,
      }));

    return NextResponse.json(
      {
        migrations: paginatedMigrations,
        total: total,
        limit: limit,
        skip: skip,
        hasMore: skip + limit < total,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Failed to list migrations:', error);

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
 * POST /api/migration/items
 * Create new item migration job
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
    const body = (await request.json()) as ItemMigrationRequestPayload;

    // LOG: Request payload received from frontend
    console.log('📥 Item migration API - Request received:', {
      sourceAppId: body.sourceAppId,
      targetAppId: body.targetAppId,
      mode: body.mode,
      sourceMatchField: body.sourceMatchField,
      targetMatchField: body.targetMatchField,
      duplicateBehavior: body.duplicateBehavior,
      batchSize: body.batchSize,
      concurrency: body.concurrency,
      maxItems: body.maxItems,
      transferFiles: body.transferFiles,
      dryRun: body.dryRun,
    });

    // Validate required fields
    if (!body.sourceAppId || !body.targetAppId) {
      return NextResponse.json(
        {
          error: 'Invalid request',
          message: 'sourceAppId and targetAppId are required',
        },
        { status: 400 }
      );
    }

    // Create migration job
    const { jobId, fieldMapping } = await createItemMigrationJob(body);

    // Start background job execution (non-blocking)
    runItemMigrationJob(jobId).catch((error) => {
      console.error('Background job execution failed:', error);
    });

    // Return job ID and field mapping immediately
    return NextResponse.json(
      {
        jobId,
        fieldMapping,
        status: 'Job created and started',
      },
      { status: 202 } // 202 Accepted
    );
  } catch (error) {
    console.error('Failed to create item migration job:', error);

    return NextResponse.json(
      {
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
