import { NextResponse } from 'next/server';
import { getSpaces } from '@/lib/podio/resources/spaces';
import { isPodioConfigured } from '@/lib/podio/config';
import { PodioApiError } from '@/lib/podio/errors';

/**
 * GET /api/podio/organizations/[orgId]/spaces
 * Fetch all spaces (workspaces) in a specific organization
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgId: string }> }
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

    // Validate orgId parameter
    const orgId = parseInt(resolvedParams.orgId, 10);
    if (isNaN(orgId) || orgId <= 0) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'INVALID_ORG_ID',
            message: 'Organization ID must be a positive integer.',
          },
        },
        { status: 400 }
      );
    }

    // Fetch spaces from Podio
    const spaces = await getSpaces(orgId);

    return NextResponse.json({
      success: true,
      data: spaces,
    });
  } catch (error) {
    console.error('Error fetching spaces:', error);

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
          message: 'An unexpected error occurred while fetching spaces.',
        },
      },
      { status: 500 }
    );
  }
}
