/**
 * App-specific cache management API endpoints
 * Provides control over cache for individual Podio apps
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAppStructureCache } from '@/lib/migration/items/app-structure-cache';
import { logger as migrationLogger } from '@/lib/migration/logging';

/**
 * DELETE /api/cache/[appId]
 * Clear cache for a specific app
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string }> }
) {
  try {
    const { appId: appIdStr } = await params;
    const appId = parseInt(appIdStr, 10);

    if (isNaN(appId)) {
      return NextResponse.json(
        {
          success: false,
          error: {
            message: 'Invalid app ID',
            details: 'App ID must be a valid number',
          },
        },
        { status: 400 }
      );
    }

    const appStructureCache = getAppStructureCache();

    // Check if app is cached before clearing
    const isCached = appStructureCache.isCached(appId);

    // Clear cache for specific app
    appStructureCache.clearAppStructure(appId);

    migrationLogger.info('App-specific cache cleared', {
      appId,
      wasCached: isCached,
    });

    return NextResponse.json({
      success: true,
      data: {
        appId,
        cleared: isCached,
      },
    });
  } catch (error) {
    const { appId: appIdStr } = await params;
    migrationLogger.error('Failed to clear app cache', {
      appId: appIdStr,
      error: error instanceof Error ? error.message : String(error),
    });

    return NextResponse.json(
      {
        success: false,
        error: {
          message: 'Failed to clear app cache',
          details: error instanceof Error ? error.message : String(error),
        },
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/cache/[appId]
 * Force refresh app structure cache from API
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string }> }
) {
  try {
    const { appId: appIdStr } = await params;
    const appId = parseInt(appIdStr, 10);

    if (isNaN(appId)) {
      return NextResponse.json(
        {
          success: false,
          error: {
            message: 'Invalid app ID',
            details: 'App ID must be a valid number',
          },
        },
        { status: 400 }
      );
    }

    const appStructureCache = getAppStructureCache();

    // Force refresh (clears and re-fetches)
    const app = await appStructureCache.refreshAppStructure(appId);

    migrationLogger.info('App structure cache refreshed', {
      appId,
      fieldsLoaded: app.fields?.length || 0,
    });

    return NextResponse.json({
      success: true,
      data: {
        appId,
        fieldsLoaded: app.fields?.length || 0,
      },
    });
  } catch (error) {
    const { appId: appIdStr } = await params;
    migrationLogger.error('Failed to refresh app cache', {
      appId: appIdStr,
      error: error instanceof Error ? error.message : String(error),
    });

    return NextResponse.json(
      {
        success: false,
        error: {
          message: 'Failed to refresh app cache',
          details: error instanceof Error ? error.message : String(error),
        },
      },
      { status: 500 }
    );
  }
}
