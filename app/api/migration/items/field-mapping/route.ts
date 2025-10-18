/**
 * Field Mapping API - POST endpoint
 * Generates auto field mapping between source and target apps
 */

import { NextRequest, NextResponse } from 'next/server';
import { buildDefaultFieldMapping } from '@/lib/migration/items/service';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { sourceAppId, targetAppId } = body;

    if (!sourceAppId || !targetAppId) {
      return NextResponse.json(
        { error: 'sourceAppId and targetAppId are required' },
        { status: 400 }
      );
    }

    const fieldMapping = await buildDefaultFieldMapping(
      parseInt(sourceAppId),
      parseInt(targetAppId)
    );

    return NextResponse.json({ fieldMapping }, { status: 200 });
  } catch (error) {
    console.error('Failed to build field mapping:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
