import { NextResponse } from 'next/server';
import { getFlowCloneJobStatus } from '@/lib/globiflow/service';
import { isPodioConfigured } from '@/lib/podio/config';
import { FlowCloneJobStatusResponse } from '@/lib/globiflow/types';

/**
 * GET /api/globiflow/jobs/[jobId]
 * Get status of a GlobiFlow clone job
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    // Check if Podio is configured
    if (!isPodioConfigured()) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'PODIO_NOT_CONFIGURED',
            message: 'Podio integration is not configured. Please set required environment variables.',
          },
        },
        { status: 503 }
      );
    }

    // Await params (Next.js 15 requirement)
    const { jobId } = await params;

    if (!jobId) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'INVALID_JOB_ID',
            message: 'Job ID is required.',
          },
        },
        { status: 400 }
      );
    }

    // Get job status
    const job = await getFlowCloneJobStatus(jobId);

    if (!job) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'JOB_NOT_FOUND',
            message: 'Flow clone job not found.',
          },
        },
        { status: 404 }
      );
    }

    // Map to response format
    const response: FlowCloneJobStatusResponse = {
      jobId: job.id,
      status: job.status === 'planning' ? 'pending' : job.status,
      progress: {
        total: job.steps.length,
        completed: job.steps.filter((s) => s.status === 'completed').length,
        failed: job.steps.filter((s) => s.status === 'failed').length,
      },
      steps: job.steps.map((step) => ({
        ...step,
        type: 'clone_flow',
        flowId: step.sourceId,
        flowName: step.sourceId, // TODO: Add flow names to step metadata
        targetFlowId: step.targetId,
        error: step.error
          ? {
              message: step.error,
            }
          : undefined,
      })),
      startedAt: job.startedAt?.toISOString(),
      completedAt: job.completedAt?.toISOString(),
      error: job.errors.length > 0 ? job.errors[0].message : undefined,
    };

    return NextResponse.json({
      success: true,
      data: response,
    });
  } catch (error) {
    console.error('Error fetching job status:', error);

    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred while fetching job status.',
        },
      },
      { status: 500 }
    );
  }
}
