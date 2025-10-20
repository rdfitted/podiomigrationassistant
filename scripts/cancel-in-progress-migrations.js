import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const migrationsDir = path.join(__dirname, '..', 'data', 'migrations');

// Read all migration files
const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.json'));

let inProgressCount = 0;
let cancelledCount = 0;

console.log(`Found ${files.length} migration files. Checking for in_progress migrations...\n`);

files.forEach(file => {
  const filePath = path.join(migrationsDir, file);
  const content = fs.readFileSync(filePath, 'utf8');
  const migration = JSON.parse(content);

  if (migration.status === 'in_progress') {
    inProgressCount++;
    console.log(`Found in_progress migration: ${migration.id}`);
    console.log(`  Created: ${migration.createdAt}`);
    console.log(`  Updated: ${migration.updatedAt}`);

    // Update status to cancelled
    migration.status = 'cancelled';
    migration.updatedAt = new Date().toISOString();
    migration.cancelledAt = new Date().toISOString();

    // Add cancellation reason
    if (!migration.error) {
      migration.error = {
        message: 'Migration manually cancelled by user',
        code: 'USER_CANCELLED',
        timestamp: new Date().toISOString()
      };
    }

    // Write back to file
    fs.writeFileSync(filePath, JSON.stringify(migration, null, 2));
    cancelledCount++;
    console.log(`  ✓ Cancelled\n`);
  }
});

console.log(`\nSummary:`);
console.log(`  Total migrations: ${files.length}`);
console.log(`  In progress found: ${inProgressCount}`);
console.log(`  Cancelled: ${cancelledCount}`);
