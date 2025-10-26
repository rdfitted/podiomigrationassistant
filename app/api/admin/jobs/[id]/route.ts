/**
 * Admin API for Individual Job Management
 * Provides endpoints for force-canceling and managing specific jobs
 */

import { NextRequest, NextResponse } from 'next/server';
import { migrationStateStore } from '@/lib/migration/state-store';
import { getJobHealth } from '@/lib/migration/job-lifecycle';
import { logger } from '@/lib/migration/logging';

/**
 * GET /api/admin/jobs/[id]
 * Get detailed job information with health status
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: jobId } = await params;
    logger.info('Admin API: Getting job details', { jobId });

    const job = await migrationStateStore.getMigrationJob(jobId);

    if (!job) {
      return NextResponse.json(
        { error: 'Job not found', jobId },
        { status: 404 }
      );
    }

    const health = await getJobHealth(jobId);

    return NextResponse.json({
      job: {
        id: job.id,
        jobType: job.jobType,
        status: job.status,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
        lastHeartbeat: job.lastHeartbeat,
        progress: job.progress,
        errors: job.errors,
        metadata: job.metadata,
      },
      health,
    });
  } catch (error) {
    logger.error('Admin API: Failed to get job', { error });
    return NextResponse.json(
      { error: 'Failed to get job', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/jobs/[id]
 * Perform actions on a specific job
 * Supported actions: force-cancel, force-complete
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: jobId } = await params;
    const body = await request.json();
    const action = body.action;

    logger.info('Admin API: Performing action on job', { jobId, action });

    const job = await migrationStateStore.getMigrationJob(jobId);

    if (!job) {
      return NextResponse.json(
        { error: 'Job not found', jobId },
        { status: 404 }
      );
    }

    if (action === 'force-cancel') {
      // Force-cancel a stuck job
      logger.warn('Admin API: Force-canceling job', { jobId, currentStatus: job.status });

      await migrationStateStore.updateJobStatus(jobId, 'cancelled', new Date());
      await migrationStateStore.addMigrationError(
        jobId,
        'admin_action',
        'Job force-cancelled by admin via API. Original status: ' + job.status,
        'ADMIN_FORCE_CANCEL'
      );

      return NextResponse.json({
        success: true,
        message: `Job ${jobId} force-cancelled`,
        previousStatus: job.status,
        newStatus: 'cancelled',
      });
    } else if (action === 'force-complete') {
      // Force-complete a job (use with caution)
      logger.warn('Admin API: Force-completing job', { jobId, currentStatus: job.status });

      await migrationStateStore.updateJobStatus(jobId, 'completed', new Date());
      await migrationStateStore.addMigrationError(
        jobId,
        'admin_action',
        'Job force-completed by admin via API. Original status: ' + job.status + '. Use with caution - verify data integrity.',
        'ADMIN_FORCE_COMPLETE'
      );

      return NextResponse.json({
        success: true,
        message: `Job ${jobId} force-completed`,
        previousStatus: job.status,
        newStatus: 'completed',
      });
    } else if (action === 'force-fail') {
      // Force-fail a job
      logger.warn('Admin API: Force-failing job', { jobId, currentStatus: job.status });

      await migrationStateStore.updateJobStatus(jobId, 'failed', new Date());
      await migrationStateStore.addMigrationError(
        jobId,
        'admin_action',
        'Job force-failed by admin via API. Original status: ' + job.status,
        'ADMIN_FORCE_FAIL'
      );

      return NextResponse.json({
        success: true,
        message: `Job ${jobId} force-failed`,
        previousStatus: job.status,
        newStatus: 'failed',
      });
    } else {
      return NextResponse.json(
        { error: 'Invalid action. Supported actions: force-cancel, force-complete, force-fail' },
        { status: 400 }
      );
    }
  } catch (error) {
    logger.error('Admin API: Failed to perform action', { error });
    return NextResponse.json(
      { error: 'Failed to perform action', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
