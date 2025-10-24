#!/usr/bin/env tsx
/**
 * Utility script to mark all migration jobs as completed
 */

import { migrationStateStore } from '../lib/migration/state-store';

async function markAllJobsComplete() {
  console.log('Initializing migration state store...');
  await migrationStateStore.initialize();

  console.log('Loading all migration jobs...');
  const jobs = await migrationStateStore.listMigrationJobs();

  console.log(`Found ${jobs.length} migration jobs\n`);

  let updatedCount = 0;
  let alreadyCompletedCount = 0;
  let failedCount = 0;

  for (const job of jobs) {
    try {
      if (job.status === 'in_progress') {
        console.log(`→ Updating job ${job.id} from "in_progress" to "completed"`);
        await migrationStateStore.updateJobStatus(job.id, 'completed', new Date());
        updatedCount++;
      } else {
        console.log(`- Job ${job.id} has status "${job.status}" (skipping)`);
        alreadyCompletedCount++;
      }
    } catch (error) {
      console.error(`✗ Failed to update job ${job.id}:`, error);
      failedCount++;
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('Summary:');
  console.log(`  Total jobs: ${jobs.length}`);
  console.log(`  Updated (in_progress → completed): ${updatedCount}`);
  console.log(`  Skipped (other statuses): ${alreadyCompletedCount}`);
  console.log(`  Failed: ${failedCount}`);
  console.log('='.repeat(60));
}

markAllJobsComplete()
  .then(() => {
    console.log('\n✓ All jobs processed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n✗ Error:', error);
    process.exit(1);
  });
