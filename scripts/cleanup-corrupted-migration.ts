/**
 * Cleanup Corrupted Migration File
 *
 * This script repairs corrupted migration files by:
 * 1. Loading the file up to the corruption point
 * 2. Attempting to parse partial JSON
 * 3. Reconstructing the migration state with limited failedItems
 * 4. Saving the cleaned version
 *
 * Usage:
 *   npx ts-node scripts/cleanup-corrupted-migration.ts <jobId>
 *
 * Example:
 *   npx ts-node scripts/cleanup-corrupted-migration.ts 8c408749-5445-4880-b1be-003aeee885e9
 */

import { promises as fs } from 'fs';
import path from 'path';

async function cleanupCorruptedMigration(jobId: string) {
  const migrationsDir = 'data/migrations';
  const filePath = path.join(migrationsDir, `${jobId}.json`);
  const backupPath = `${filePath}.corrupted.${Date.now()}`;

  console.log(`\n🔍 Analyzing corrupted migration file: ${jobId}`);
  console.log(`   File path: ${filePath}\n`);

  try {
    // Check if file exists
    try {
      await fs.access(filePath);
    } catch {
      console.error(`❌ Error: Migration file not found: ${filePath}`);
      process.exit(1);
    }

    // Read the file content
    console.log('📖 Reading file content...');
    const fileContent = await fs.readFile(filePath, 'utf-8');
    const fileSizeBytes = Buffer.byteLength(fileContent, 'utf-8');
    const fileSizeMB = (fileSizeBytes / 1024 / 1024).toFixed(2);
    console.log(`   File size: ${fileSizeMB} MB (${fileSizeBytes.toLocaleString()} bytes)`);

    // Try to parse the JSON
    console.log('\n🔧 Attempting to parse JSON...');
    let job;
    try {
      job = JSON.parse(fileContent);
      console.log('✅ File is actually valid JSON! No corruption detected.');
      console.log(`   Failed items: ${job.progress?.failedItems?.length || 0}`);

      if (job.progress?.failedItems?.length > 10000) {
        console.log(`\n⚠️  Warning: File has ${job.progress.failedItems.length} failed items.`);
        console.log('   Trimming to most recent 10,000 items to prevent future issues...');

        // Keep only most recent 10,000
        const removed = job.progress.failedItems.length - 10000;
        job.progress.failedItems = job.progress.failedItems.slice(-10000);

        // Create backup
        console.log(`\n💾 Creating backup: ${backupPath}`);
        await fs.copyFile(filePath, backupPath);

        // Save cleaned version
        console.log('💾 Saving cleaned version...');
        await fs.writeFile(filePath, JSON.stringify(job, null, 2), 'utf-8');

        console.log(`\n✅ Success! Removed ${removed.toLocaleString()} oldest failed items.`);
        console.log(`   Backup saved to: ${backupPath}`);
      } else {
        console.log('   No action needed - file is healthy.');
      }

      return;
    } catch (parseError: any) {
      console.log(`❌ JSON parse failed: ${parseError.message}`);
      console.log(`   Error at position: ${parseError.message.match(/position (\d+)/)?.[1] || 'unknown'}`);
    }

    // File is corrupted - attempt repair
    console.log('\n🔨 Attempting to repair corrupted JSON...');

    // Strategy: Find the last complete JSON structure
    // Try parsing progressively smaller chunks
    let validJson = null;
    let searchIndex = fileContent.lastIndexOf('}');

    while (searchIndex > 0 && !validJson) {
      try {
        const chunk = fileContent.substring(0, searchIndex + 1);
        validJson = JSON.parse(chunk);
        console.log(`✅ Found valid JSON ending at position ${searchIndex}`);
        break;
      } catch {
        // Try previous closing brace
        searchIndex = fileContent.lastIndexOf('}', searchIndex - 1);
      }
    }

    if (!validJson) {
      console.error('\n❌ Error: Could not find any valid JSON structure in file.');
      console.error('   The file may be completely corrupted.');
      console.error(`   Creating backup: ${backupPath}`);
      await fs.copyFile(filePath, backupPath);
      console.error('\n   Manual intervention required.');
      process.exit(1);
    }

    // Successfully recovered partial JSON
    console.log(`\n✅ Successfully recovered migration state!`);
    console.log(`   Job ID: ${validJson.id}`);
    console.log(`   Status: ${validJson.status}`);
    console.log(`   Progress: ${validJson.progress?.processed || 0} / ${validJson.progress?.total || 0}`);
    console.log(`   Failed items in recovered state: ${validJson.progress?.failedItems?.length || 0}`);

    // Trim failed items to prevent future issues
    if (validJson.progress?.failedItems?.length > 10000) {
      const removed = validJson.progress.failedItems.length - 10000;
      validJson.progress.failedItems = validJson.progress.failedItems.slice(-10000);
      console.log(`\n⚠️  Trimmed failed items array from ${removed + 10000} to 10,000 items`);
    }

    // Create backup of corrupted file
    console.log(`\n💾 Creating backup of corrupted file: ${backupPath}`);
    await fs.copyFile(filePath, backupPath);

    // Save repaired version
    console.log('💾 Saving repaired version...');
    const repairedJson = JSON.stringify(validJson, null, 2);
    await fs.writeFile(filePath, repairedJson, 'utf-8');

    const repairedSizeMB = (Buffer.byteLength(repairedJson, 'utf-8') / 1024 / 1024).toFixed(2);
    console.log(`\n✅ Success! Migration file repaired.`);
    console.log(`   Original size: ${fileSizeMB} MB`);
    console.log(`   Repaired size: ${repairedSizeMB} MB`);
    console.log(`   Backup saved to: ${backupPath}`);

  } catch (error) {
    console.error('\n❌ Unexpected error:', error);
    process.exit(1);
  }
}

// Main execution
const jobId = process.argv[2];

if (!jobId) {
  console.error('Usage: npx ts-node scripts/cleanup-corrupted-migration.ts <jobId>');
  console.error('Example: npx ts-node scripts/cleanup-corrupted-migration.ts 8c408749-5445-4880-b1be-003aeee885e9');
  process.exit(1);
}

cleanupCorruptedMigration(jobId);
