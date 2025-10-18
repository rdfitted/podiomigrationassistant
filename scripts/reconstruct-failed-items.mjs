/**
 * Script to reconstruct failedItems array for migration c250d83d-6281-476d-957e-f3f3ab11504f
 *
 * Compares source and target apps to identify which items failed to migrate
 */

import { getPodioHttpClient } from '../lib/podio/http/client.js';
import { streamItems, extractFieldValue } from '../lib/podio/resources/items.js';
import { migrationStateStore } from '../lib/migration/state-store.js';

const MIGRATION_ID = 'c250d83d-6281-476d-957e-f3f3ab11504f';
const SOURCE_APP_ID = 24867466;
const TARGET_APP_ID = 30498192;
const MATCH_FIELD = 'podioitemid';

async function reconstructFailedItems() {
  console.log('🔍 Reconstructing failed items for migration:', MIGRATION_ID);
  console.log('Source App:', SOURCE_APP_ID);
  console.log('Target App:', TARGET_APP_ID);
  console.log('Match Field:', MATCH_FIELD);
  console.log('');

  const client = getPodioHttpClient();

  // Step 1: Fetch all successfully migrated items from target app
  console.log('📥 Step 1: Fetching successfully migrated items from target app...');
  const successfulSourceIds = new Set();
  let targetItemCount = 0;

  for await (const batch of streamItems(client, TARGET_APP_ID, { batchSize: 500 })) {
    for (const item of batch) {
      // Find the podioitemid field (which stores the source item ID)
      const matchField = item.fields.find(f => f.external_id === MATCH_FIELD);
      if (matchField) {
        const sourceItemId = extractFieldValue(matchField);
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
  console.log('');

  // Step 2: Fetch all items from source app and identify failures
  console.log('📥 Step 2: Fetching all items from source app...');
  const failedSourceIds = [];
  let sourceItemCount = 0;
  let skippedCount = 0;

  for await (const batch of streamItems(client, SOURCE_APP_ID, { batchSize: 500 })) {
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
  console.log('');

  // Step 3: Build failedItems array
  console.log('📝 Step 3: Building failedItems array...');
  const failedItems = failedSourceIds.map(sourceItemId => ({
    sourceItemId,
    error: 'Failed during initial migration (likely rate limit or transient error)',
    errorCategory: 'unknown',
    attemptCount: 1,
    firstAttemptAt: new Date('2025-10-17T23:50:24.250Z'), // Original migration start time
    lastAttemptAt: new Date('2025-10-18T16:55:41.698Z'),  // Original migration end time
  }));

  console.log(`✓ Created ${failedItems.length} failedItem entries`);
  console.log('');

  // Step 4: Update migration state
  console.log('💾 Step 4: Updating migration state...');
  const job = await migrationStateStore.getMigrationJob(MIGRATION_ID);

  if (!job) {
    console.error('❌ Migration job not found!');
    return;
  }

  // Update progress with failedItems array
  const updatedJob = {
    ...job,
    progress: {
      ...job.progress,
      failedItems,
    },
  };

  await migrationStateStore.saveMigrationJob(updatedJob);
  console.log('✓ Migration state updated with failedItems array');
  console.log('');

  // Step 5: Verification
  console.log('✅ Verification:');
  console.log(`  - Expected failures: 16,690`);
  console.log(`  - Reconstructed failures: ${failedItems.length}`);
  console.log(`  - Match: ${failedItems.length === 16690 ? 'YES ✓' : 'NO ✗'}`);
  console.log('');

  if (failedItems.length !== 16690) {
    console.warn('⚠️  WARNING: Reconstructed count does not match expected count!');
    console.warn(`   This could mean some items were migrated manually or the counts were inaccurate.`);
  }

  console.log('🎉 Done! You can now retry this migration and it will use the failedItems list.');
  console.log(`   Run: POST /api/migration/items/${MIGRATION_ID}/retry`);
}

// Run the script
reconstructFailedItems().catch(error => {
  console.error('❌ Script failed:', error);
  process.exit(1);
});
