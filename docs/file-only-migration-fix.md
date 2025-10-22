# File-Only Migration Fix

## Migration ID
`55ddae23-ce86-41fa-92e3-49849f692625`

## Issue Summary
File-only migration in UPDATE mode failed with 248/248 items rejected by Podio API.

## Root Cause

When running a file-only migration (transferFiles=true with empty field mapping):

1. **Empty field mapping**: `fieldMapping: {}` (intentional for file-only mode)
2. **Empty update payload**: `mapItemFields()` returns `{}` for each item
3. **API rejection**: System calls `PUT /item/{id}` with body `{ fields: {} }`
4. **Podio rejects empty updates**: API returns error because there are no fields to update
5. **File transfer never reached**: Items fail before file transfer logic executes

### Code Flow
```typescript
// item-migrator.ts:898
const mappedFields = mapItemFields(sourceItem, externalIdFieldMapping);
// returns {} when fieldMapping is empty

// batch-processor.ts:402 (BEFORE FIX)
const batchResult = await bulkUpdateItems(this.client, batch, ...);
// Sends PUT /item/{id} with { fields: {} }
// Podio rejects → all items fail

// File transfer code never executes because items failed
```

## Solution

**File**: `lib/migration/items/batch-processor.ts`

Added detection for file-only migrations and skips the item update API call entirely:

```typescript
// Check if this is a file-only migration (empty fields + transferFiles enabled)
const isFileOnlyMigration = this.config.transferFiles &&
  batch.every(update => Object.keys(update.fields).length === 0);

let batchResult: BulkUpdateResult;

if (isFileOnlyMigration) {
  // File-only migration: Skip item updates, only transfer files
  migrationLogger.info('File-only migration detected - skipping field updates', {
    batchNumber: batchNum + 1,
    itemCount: batch.length,
  });

  // Create a mock successful result (no actual API calls for updates)
  batchResult = {
    successful: batch.map((update, idx) => ({
      itemId: update.itemId,
      revision: 0, // No revision change since we didn't update
    })),
    failed: [],
    successCount: batch.length,
    failureCount: 0,
  };
} else {
  // Normal migration: Update item fields
  batchResult = await bulkUpdateItems(this.client, batch, ...);
}

// File transfer proceeds with all items marked as "successful"
```

## How It Works

1. **Detection**: Before calling `bulkUpdateItems`, check if:
   - `transferFiles` is enabled AND
   - All items in batch have empty `fields` object

2. **Skip Update**: If file-only migration detected:
   - Skip `bulkUpdateItems` API call (avoids Podio rejection)
   - Create mock success result for all items
   - Log "File-only migration detected"

3. **File Transfer**: Proceeds as normal with all items in the "successful" list

## Impact

- **Before**: 100% failure rate for file-only migrations (0/248 succeeded)
- **After**: File-only migrations succeed (files transferred without field updates)
- **Normal migrations**: Unchanged behavior (still updates fields as before)

## Testing

To test the fix:

```typescript
// Example: Migrate files from app 27372907 to 30498196 without updating fields
await migrateItems({
  sourceAppId: 27372907,
  targetAppId: 30498196,
  mode: 'update',
  fieldMapping: {}, // Empty mapping = file-only mode
  sourceMatchField: 'podioitemid',
  targetMatchField: 'podioitemid',
  transferFiles: true, // Enable file transfer
  duplicateBehavior: 'skip'
});
```

## Related Files Changed

1. `lib/migration/items/batch-processor.ts` - Main fix
2. `lib/globiflow/types.ts` - Added missing job status types
3. `app/components/migration/DryRunPreview.tsx` - Fixed TypeScript error
4. `app/hooks/useCleanup.ts` - Fixed TypeScript error

## Migration State Analysis

From `data/migrations/55ddae23-ce86-41fa-92e3-49849f692625.json`:

```json
{
  "metadata": {
    "mode": "update",
    "fieldMapping": {},  // ← Empty mapping triggered the issue
    "sourceMatchField": "podioitemid",
    "targetMatchField": "podioitemid",
    "duplicateBehavior": "skip"
  },
  "progress": {
    "total": 248,
    "processed": 248,
    "successful": 0,   // ← ALL FAILED
    "failed": 248,     // ← 100% failure rate
  }
}
```

## Verification Steps

After applying the fix:

1. Retry the same migration with `transferFiles: true`
2. Verify logs show "File-only migration detected"
3. Verify no `bulkUpdateItems` API calls are made
4. Verify files are transferred successfully
5. Verify success count = total items (not 0)
