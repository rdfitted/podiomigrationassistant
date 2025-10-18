import { NextResponse } from 'next/server';
import { listAppFlows } from '@/lib/globiflow/service';
import { isPodioConfigured } from '@/lib/podio/config';
import { PodioApiError } from '@/lib/podio/errors';

/**
 * GET /api/globiflow/apps/[appId]/flows
 * Fetch all GlobiFlow automations for an application
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ appId: string }> }
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
    const resolvedParams = await params;

    // Parse and validate appId
    const appId = parseInt(resolvedParams.appId, 10);
    if (isNaN(appId)) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'INVALID_APP_ID',
            message: 'Invalid application ID provided.',
          },
        },
        { status: 400 }
      );
    }

    // Fetch flows for the application
    const flows = await listAppFlows(appId);

    return NextResponse.json({
      success: true,
      data: flows,
    });
  } catch (error) {
    console.error('Error fetching flows:', error);

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
          message: 'An unexpected error occurred while fetching flows.',
        },
      },
      { status: 500 }
    );
  }
}
