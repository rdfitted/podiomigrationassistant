/**
 * App Structure API - GET endpoint
 * Returns app structure with fields for field mapping UI
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAppStructureDetailed } from '@/lib/podio/migration';

export const runtime = 'nodejs';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string }> }
) {
  try {
    const { appId } = await params;
    const appIdNum = parseInt(appId);

    if (isNaN(appIdNum)) {
      return NextResponse.json(
        { error: 'Invalid app ID' },
        { status: 400 }
      );
    }

    const structure = await getAppStructureDetailed(appIdNum);
    return NextResponse.json(structure, { status: 200 });
  } catch (error) {
    console.error('Failed to get app structure:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
