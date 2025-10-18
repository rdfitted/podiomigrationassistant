/**
 * Cache management API endpoints
 * Provides manual control over app structure and prefetch caches
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAppStructureCache } from '@/lib/migration/items/app-structure-cache';
import { logger as migrationLogger } from '@/lib/migration/logging';

/**
 * GET /api/cache/status
 * Get cache statistics for all caches
 */
export async function GET(request: NextRequest) {
  try {
    const appStructureCache = getAppStructureCache();
    const stats = appStructureCache.getCacheStats();

    migrationLogger.info('Cache status requested', {
      appStructureCache: stats,
    });

    return NextResponse.json({
      success: true,
      data: {
        appStructureCache: stats,
      },
    });
  } catch (error) {
    migrationLogger.error('Failed to get cache status', {
      error: error instanceof Error ? error.message : String(error),
    });

    return NextResponse.json(
      {
        success: false,
        error: {
          message: 'Failed to get cache status',
          details: error instanceof Error ? error.message : String(error),
        },
      },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/cache
 * Clear all caches (app structure cache)
 */
export async function DELETE(request: NextRequest) {
  try {
    const appStructureCache = getAppStructureCache();

    // Get stats before clearing for reporting
    const statsBefore = appStructureCache.getCacheStats();

    // Clear all caches
    appStructureCache.clearAll();

    migrationLogger.info('All caches cleared', {
      appsCleared: statsBefore.totalApps,
      fieldsCleared: statsBefore.totalFields,
    });

    return NextResponse.json({
      success: true,
      data: {
        clearedCaches: ['appStructure'],
        appsCleared: statsBefore.totalApps,
        fieldsCleared: statsBefore.totalFields,
      },
    });
  } catch (error) {
    migrationLogger.error('Failed to clear caches', {
      error: error instanceof Error ? error.message : String(error),
    });

    return NextResponse.json(
      {
        success: false,
        error: {
          message: 'Failed to clear caches',
          details: error instanceof Error ? error.message : String(error),
        },
      },
      { status: 500 }
    );
  }
}
