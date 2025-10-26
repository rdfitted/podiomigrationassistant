/**
 * Admin API for Job Management
 * Provides endpoints for listing, monitoring, and managing migration jobs
 */

import { NextRequest, NextResponse } from 'next/server';
import { migrationStateStore } from '@/lib/migration/state-store';
import { getJobHealth, cleanupStaleJobs } from '@/lib/migration/job-lifecycle';
import { logger } from '@/lib/migration/logging';

/**
 * GET /api/admin/jobs
 * List all migration jobs with health status
 */
export async function GET(request: NextRequest) {
  try {
    logger.info('Admin API: Listing all jobs');

    const allJobs = await migrationStateStore.listMigrationJobs();

    // Get health status for each job
    const jobsWithHealth = await Promise.all(
      allJobs.map(async (job) => {
        const health = await getJobHealth(job.id);
        return {
          jobId: job.id,
          jobType: job.jobType,
          status: job.status,
          startedAt: job.startedAt,
          completedAt: job.completedAt,
          lastHeartbeat: job.lastHeartbeat,
          health: {
            isActive: health.isActive,
            healthStatus: health.healthStatus,
            timeSinceHeartbeat: health.timeSinceHeartbeat,
          },
          progress: job.progress
            ? {
                total: job.progress.total,
                processed: job.progress.processed,
                successful: job.progress.successful,
                failed: job.progress.failed,
                percent: job.progress.percent,
              }
            : undefined,
          metadata: {
            sourceAppId: (job.metadata as any)?.sourceAppId,
            targetAppId: (job.metadata as any)?.targetAppId,
          },
        };
      })
    );

    // Group by health status
    const healthy = jobsWithHealth.filter(j => j.health.healthStatus === 'healthy');
    const stale = jobsWithHealth.filter(j => j.health.healthStatus === 'stale');
    const notRunning = jobsWithHealth.filter(j => j.health.healthStatus === 'not_running');

    return NextResponse.json({
      total: allJobs.length,
      summary: {
        healthy: healthy.length,
        stale: stale.length,
        notRunning: notRunning.length,
      },
      jobs: jobsWithHealth,
    });
  } catch (error) {
    logger.error('Admin API: Failed to list jobs', { error });
    return NextResponse.json(
      { error: 'Failed to list jobs', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/jobs (with action=cleanup-stale)
 * Cleanup all stale jobs
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const action = body.action;

    if (action === 'cleanup-stale') {
      logger.info('Admin API: Cleaning up stale jobs');

      const cleanedCount = await cleanupStaleJobs();

      return NextResponse.json({
        success: true,
        message: `Cleaned up ${cleanedCount} stale job(s)`,
        cleanedCount,
      });
    } else {
      return NextResponse.json(
        { error: 'Invalid action. Use action=cleanup-stale' },
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
