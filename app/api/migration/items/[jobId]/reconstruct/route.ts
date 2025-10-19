/**
 * Reconstruct failedItems array for a migration
 * POST /api/migration/items/{jobId}/reconstruct
 */

import { NextRequest, NextResponse } from 'next/server';
import { migrationStateStore, MigrationJob } from '@/lib/migration/state-store';
import { getPodioHttpClient } from '@/lib/podio/http/client';
import { streamItems, extractFieldValue } from '@/lib/podio/resources/items';

export const runtime = 'nodejs';
export const maxDuration = 7200; // 2 hours

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await params;

    console.log('🔍 Reconstructing failed items for migration:', jobId);

    // Get job details
    const job = await migrationStateStore.getMigrationJob(jobId);
    if (!job) {
      return NextResponse.json(
        { error: 'Job not found', message: `No migration job found with ID: ${jobId}` },
        { status: 404 }
      );
    }

    const metadata = job.metadata as any;
    const sourceAppId = metadata.sourceAppId;
    const targetAppId = metadata.targetAppId;
    const matchField = metadata.sourceMatchField || metadata.targetMatchField;

    if (!sourceAppId || !targetAppId) {
      return NextResponse.json(
        { error: 'Invalid job', message: 'Job is missing sourceAppId or targetAppId' },
        { status: 400 }
      );
    }

    if (!matchField) {
      return NextResponse.json(
        { error: 'Invalid job', message: 'Job is missing match field for duplicate detection' },
        { status: 400 }
      );
    }

    console.log('Source App:', sourceAppId);
    console.log('Target App:', targetAppId);
    console.log('Match Field:', matchField);

    const client = getPodioHttpClient();

    // Step 1: Fetch all successfully migrated items from target app
    console.log('📥 Step 1: Fetching successfully migrated items from target app...');
    const successfulSourceIds = new Set<number>();
    let targetItemCount = 0;

    for await (const batch of streamItems(client, targetAppId, { batchSize: 500 })) {
      for (const item of batch) {
        // Find the match field (which stores the source item ID)
        const field = item.fields.find(f => f.external_id === matchField);
        if (field) {
          const sourceItemId = extractFieldValue(field);
          if (sourceItemId && typeof sourceItemId === 'number') {
            successfulSourceIds.add(sourceItemId);
          } else if (sourceItemId && typeof sourceItemId === 'string') {
            const parsed = parseInt(sourceItemId, 10);
            if (!isNaN(parsed)) {
              successfulSourceIds.add(parsed);
            }
          }
        }
        targetItemCount++;
      }

      console.log(`  Processed ${targetItemCount} target items, found ${successfulSourceIds.size} with source IDs`);
    }

    console.log(`✓ Found ${successfulSourceIds.size} successfully migrated items`);

    // Step 2: Fetch all items from source app and identify failures
    console.log('📥 Step 2: Fetching all items from source app...');
    const failedSourceIds: number[] = [];
    let sourceItemCount = 0;
    let skippedCount = 0;

    for await (const batch of streamItems(client, sourceAppId, { batchSize: 500 })) {
      for (const item of batch) {
        sourceItemCount++;

        // Check if this source item was successfully migrated
        if (!successfulSourceIds.has(item.item_id)) {
          failedSourceIds.push(item.item_id);
        } else {
          skippedCount++;
        }
      }

      console.log(`  Processed ${sourceItemCount} source items, found ${failedSourceIds.length} failures`);
    }

    console.log(`✓ Total source items: ${sourceItemCount}`);
    console.log(`✓ Successfully migrated: ${skippedCount}`);
    console.log(`✓ Failed to migrate: ${failedSourceIds.length}`);

    // Step 3: Build failedItems array
    console.log('📝 Step 3: Building failedItems array...');
    const failedItems = failedSourceIds.map(sourceItemId => ({
      sourceItemId,
      error: 'Failed during initial migration (likely rate limit or transient error)',
      errorCategory: 'unknown' as const,
      attemptCount: 1,
      firstAttemptAt: new Date(job.startedAt),
      lastAttemptAt: job.completedAt ? new Date(job.completedAt) : new Date(),
    }));

    console.log(`✓ Created ${failedItems.length} failedItem entries`);

    // Step 4: Update migration state
    console.log('💾 Step 4: Updating migration state...');
    const updatedJob = {
      ...job,
      progress: {
        ...job.progress,
        failedItems,
      },
    } as MigrationJob;

    await migrationStateStore.saveMigrationJob(updatedJob);
    console.log('✓ Migration state updated with failedItems array');

    // Return results
    return NextResponse.json({
      success: true,
      message: 'Successfully reconstructed failedItems array',
      jobId,
      statistics: {
        totalSourceItems: sourceItemCount,
        successfullyMigrated: skippedCount,
        failedToMigrate: failedSourceIds.length,
        expectedFailures: job.progress?.failed || 0,
        match: failedSourceIds.length === (job.progress?.failed || 0),
      },
      failedItemsCount: failedItems.length,
    });
  } catch (error) {
    console.error('Failed to reconstruct failedItems:', error);

    return NextResponse.json(
      {
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
