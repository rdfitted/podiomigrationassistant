/**
 * Field Mapping Validation API
 * POST: Validate field mappings by creating test items
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { itemMigrator } from '@/lib/migration/items/item-migrator';

export const runtime = 'nodejs';

// Zod schema for request validation
const ValidationRequestSchema = z.object({
  sourceAppId: z.coerce.number().int().positive('Source app ID must be a positive integer'),
  targetAppId: z.coerce.number().int().positive('Target app ID must be a positive integer'),
  fieldMapping: z.record(z.string(), z.string()).refine(
    (mapping) => Object.keys(mapping).length > 0,
    'Field mapping must contain at least one field'
  ),
});

/**
 * POST /api/migration/items/validate
 * Validate field mappings by creating and deleting test items
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Validate and parse request body
    const parsed = ValidationRequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          valid: false,
          error: `Invalid request: ${parsed.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`,
          testedItems: 0,
          successfulCreates: 0,
          failedCreates: 0,
        },
        { status: 400 }
      );
    }

    // Run validation
    const result = await itemMigrator.validateFieldMapping({
      sourceAppId: parsed.data.sourceAppId,
      targetAppId: parsed.data.targetAppId,
      fieldMapping: parsed.data.fieldMapping,
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
