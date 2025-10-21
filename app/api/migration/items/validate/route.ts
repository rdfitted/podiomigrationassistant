/**
 * Field Mapping Validation API
 * POST: Validate field mappings by creating test items
 */

import { NextRequest, NextResponse } from 'next/server';
import { itemMigrator } from '@/lib/migration/items/item-migrator';

export const runtime = 'nodejs';

/**
 * POST /api/migration/items/validate
 * Validate field mappings by creating and deleting test items
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Validate required fields
    if (!body.sourceAppId || !body.targetAppId || !body.fieldMapping) {
      return NextResponse.json(
        {
          valid: false,
          error: 'Missing required fields: sourceAppId, targetAppId, fieldMapping',
          testedItems: 0,
          successfulCreates: 0,
          failedCreates: 0,
        },
        { status: 400 }
      );
    }

    // Run validation
    const result = await itemMigrator.validateFieldMapping({
      sourceAppId: body.sourceAppId,
      targetAppId: body.targetAppId,
      fieldMapping: body.fieldMapping,
      mode: 'create',
      batchSize: 500,
      concurrency: 5,
    });

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    console.error('Validation error:', error);

    return NextResponse.json(
      {
        valid: false,
        error: error instanceof Error ? error.message : String(error),
        testedItems: 0,
        successfulCreates: 0,
        failedCreates: 0,
      },
      { status: 500 }
    );
  }
}
