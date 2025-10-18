import { NextResponse } from 'next/server';
import { getApplications } from '@/lib/podio/resources/applications';
import { isPodioConfigured } from '@/lib/podio/config';
import { PodioApiError } from '@/lib/podio/errors';

/**
 * GET /api/podio/spaces/[spaceId]/apps
 * Fetch all applications in a specific space (workspace)
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ spaceId: string }> }
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

    // Validate spaceId parameter
    const spaceId = parseInt(resolvedParams.spaceId, 10);
    if (isNaN(spaceId) || spaceId <= 0) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'INVALID_SPACE_ID',
            message: 'Space ID must be a positive integer.',
          },
        },
        { status: 400 }
      );
    }

    // Fetch applications from Podio
    const applications = await getApplications(spaceId);

    return NextResponse.json({
      success: true,
      data: applications,
    });
  } catch (error) {
    console.error('Error fetching applications:', error);

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
          message: 'An unexpected error occurred while fetching applications.',
        },
      },
      { status: 500 }
    );
  }
}
