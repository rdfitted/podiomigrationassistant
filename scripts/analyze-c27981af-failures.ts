/**
 * Script to analyze and reconstruct failedItems for migration c27981af-4450-49f2-93fc-babba3f4a072
 */

import { getPodioHttpClient } from '../lib/podio/http/client';
import { streamItems, extractFieldValue, getItem } from '../lib/podio/resources/items';
import { migrationStateStore, MigrationJob } from '../lib/migration/state-store';

const MIGRATION_ID = 'c27981af-4450-49f2-93fc-babba3f4a072';
const SOURCE_APP_ID = 24867459;
const TARGET_APP_ID = 30498189;
const MATCH_FIELD = 'podioitemid';

async function analyzeFailures() {
  console.log('🔍 Analyzing failures for migration:', MIGRATION_ID);
  console.log('Source App:', SOURCE_APP_ID);
  console.log('Target App:', TARGET_APP_ID);
  console.log('');

  const client = getPodioHttpClient();

  // Step 1: Fetch successfully migrated items from target
  console.log('📥 Step 1: Fetching successfully migrated items...');
  const successfulSourceIds = new Set<number>();
  let targetItemCount = 0;

  for await (const batch of streamItems(client, TARGET_APP_ID, { batchSize: 500 })) {
    for (const item of batch) {
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
  }

  console.log(`✓ Found ${successfulSourceIds.size} successfully migrated items`);
  console.log('');

  // Step 2: Sample a few failed items to analyze
  console.log('📥 Step 2: Sampling failed items to identify error patterns...');
  const failedSamples: Array<{ itemId: number; hasFiles: boolean; fieldCount: number }> = [];
  let sourceItemCount = 0;
  let totalFailedCount = 0;
  const SAMPLE_SIZE = 10;

  for await (const batch of streamItems(client, SOURCE_APP_ID, { batchSize: 500 })) {
    for (const item of batch) {
      sourceItemCount++;

      if (!successfulSourceIds.has(item.item_id)) {
        totalFailedCount++;

        // Sample first 10 failures for analysis
        if (failedSamples.length < SAMPLE_SIZE) {
          const hasFiles = (item.files && item.files.length > 0) || false;
          const fieldCount = item.fields ? item.fields.length : 0;
          failedSamples.push({
            itemId: item.item_id,
            hasFiles,
            fieldCount
          });
        }
      }

      // Early exit after processing enough items to get samples
      if (failedSamples.length >= SAMPLE_SIZE && sourceItemCount > 1000) {
        break;
      }
    }

    if (failedSamples.length >= SAMPLE_SIZE && sourceItemCount > 1000) {
      break;
    }
  }

  console.log('');
  console.log('📊 Analysis Results:');
  console.log(`  Total processed: ${sourceItemCount}`);
  console.log(`  Failed items sampled: ${failedSamples.length}`);
  console.log('');

  console.log('🔬 Failed Item Characteristics:');
  const withFiles = failedSamples.filter(s => s.hasFiles).length;
  const avgFieldCount = failedSamples.reduce((sum, s) => sum + s.fieldCount, 0) / failedSamples.length;

  console.log(`  Items with files: ${withFiles}/${failedSamples.length} (${Math.round(withFiles/failedSamples.length*100)}%)`);
  console.log(`  Average field count: ${avgFieldCount.toFixed(1)}`);
  console.log('');

  console.log('Sample Failed Item IDs:');
  failedSamples.forEach(s => {
    console.log(`  - ${s.itemId} (files: ${s.hasFiles}, fields: ${s.fieldCount})`);
  });
  console.log('');

  // Step 3: Check migration metadata
  const job = await migrationStateStore.getMigrationJob(MIGRATION_ID);
  if (job) {
    console.log('📋 Migration Configuration:');
    console.log(`  Mode: ${job.metadata?.mode || 'unknown'}`);
    console.log(`  Transfer Files: ${job.metadata?.transferFiles || false}`);
    console.log(`  Field Mapping: ${JSON.stringify(job.metadata?.fieldMapping || {})}`);
    console.log(`  Duplicate Behavior: ${job.metadata?.duplicateBehavior || 'unknown'}`);
    console.log('');

    console.log('📈 Progress Stats:');
    console.log(`  Total: ${job.progress?.total || 0}`);
    console.log(`  Processed: ${job.progress?.processed || 0}`);
    console.log(`  Successful: ${job.progress?.successful || 0}`);
    console.log(`  Failed: ${job.progress?.failed || 0}`);
    console.log(`  Failure Rate: ${job.progress ? Math.round((job.progress.failed / job.progress.processed) * 100) : 0}%`);
  }

  console.log('');
  console.log('💡 Likely Failure Causes:');

  if (withFiles / failedSamples.length > 0.5) {
    console.log('  ⚠️  File transfer issues (>50% of failures have files)');
  }

  if (job?.metadata?.transferFiles === true) {
    console.log('  ⚠️  File transfers enabled - check for file format/size issues');
  }

  const fieldMapping = job?.metadata?.fieldMapping as Record<string, string> || {};
  if (Object.keys(fieldMapping).length === 1) {
    console.log('  ⚠️  Limited field mapping - only 1 field mapped');
    console.log('      This might indicate mapping issues or data validation failures');
  }

  console.log('');
}

analyzeFailures().catch(error => {
  console.error('❌ Script failed:', error);
  process.exit(1);
});
