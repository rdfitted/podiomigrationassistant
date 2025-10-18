import { NextResponse } from 'next/server';
import { createFlowCloneJob } from '@/lib/globiflow/service';
import { isPodioConfigured } from '@/lib/podio/config';
import { PodioApiError } from '@/lib/podio/errors';
import { FlowCloneRequest } from '@/lib/globiflow/types';

/**
 * POST /api/globiflow/clone
 * Initiate a GlobiFlow clone job
 */
export async function POST(request: Request) {
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

    // Parse request body
    const body: FlowCloneRequest = await request.json();

    // Validate request
    if (!body.sourceAppId || !body.targetAppId) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'INVALID_REQUEST',
            message: 'Source and target application IDs are required.',
          },
        },
        { status: 400 }
      );
    }

    if (!body.flows || body.flows.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'INVALID_REQUEST',
            message: 'At least one flow must be specified for cloning.',
          },
        },
        { status: 400 }
      );
    }

    // Create the clone job
    const job = await createFlowCloneJob(body);

    // Start job execution in the background (fire-and-forget)
    // We'll import the runner dynamically to avoid circular dependencies
    import('@/lib/globiflow/clone-runner').then(({ executeFlowCloneJob }) => {
      executeFlowCloneJob(job.id).catch((error) => {
        console.error('Flow clone job execution failed:', error);
      });
    });

    return NextResponse.json({
      success: true,
      data: {
        jobId: job.id,
        status: job.status,
        message: `Flow clone job created with ${job.steps.length} flows to clone.`,
      },
    });
  } catch (error) {
    console.error('Error creating flow clone job:', error);

    if (error instanceof PodioApiError) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: error.errorCode || 'PODIO_API_ERROR',
            message: error.toHumanReadable(),
            statusCode: error.statusCode,
          },
        },
        { status: error.statusCode || 500 }
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred while creating flow clone job.',
        },
      },
      { status: 500 }
    );
  }
}
