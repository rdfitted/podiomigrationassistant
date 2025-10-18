/**
 * Item Count API - GET endpoint
 * Returns the total count of items in an app for badge display
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPodioHttpClient } from '@/lib/podio/http/client';
import { fetchItemCount } from '@/lib/podio/resources/items';

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

    const client = getPodioHttpClient();
    const { total, filtered } = await fetchItemCount(client, appIdNum);

    return NextResponse.json(
      { count: total, filtered },
      { status: 200 }
    );
  } catch (error) {
    console.error('Failed to get item count:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
