import { NextResponse } from 'next/server';
import { getOrganizations } from '@/lib/podio/resources/organizations';
import { isPodioConfigured } from '@/lib/podio/config';
import { PodioApiError } from '@/lib/podio/errors';

/**
 * GET /api/podio/organizations
 * Fetch all organizations the authenticated user has access to
 */
export async function GET() {
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

    // Fetch organizations from Podio
    const organizations = await getOrganizations();

    return NextResponse.json({
      success: true,
      data: organizations,
    });
  } catch (error) {
    console.error('Error fetching organizations:', error);

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
          message: 'An unexpected error occurred while fetching organizations.',
        },
      },
      { status: 500 }
    );
  }
}
