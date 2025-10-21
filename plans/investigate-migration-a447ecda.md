# Investigation Plan: Migration a447ecda-d38e-442c-bb93-cee9c8f155e4

## Problem Summary
Migration processed **20,661 items** but created **0 items** (successful=0, failed=0).
All items were skipped during duplicate detection phase.

## Migration Configuration
- **Source App ID**: 24867474
- **Target App ID**: 30498191
- **Mode**: create
- **Duplicate Detection**:
  - Source Match Field: `podioitemid`
  - Target Match Field: `podioitemid`
  - Duplicate Behavior: `skip`
- **Progress**: 20,661/21,161 items processed (98%)
- **Status**: in_progress

## Root Cause Hypotheses

### Hypothesis 1: Target App Already Contains Items (Most Likely)
**Theory**: The prefetch cache correctly detected that all 20,661 items already exist in the target app with matching `podioitemid` values.

**Evidence Needed**:
1. Count items in target app 30498191
2. Check if target has ~20,000+ items
3. Verify `podioitemid` field values in target app
4. Compare sample of source vs target `podioitemid` values

**Validation Steps**:
```bash
# 1. Get target app item count
curl -H "Authorization: Bearer $TOKEN" \
  "https://api.podio.com/item/app/30498191/count"

# 2. Sample target app items and check podioitemid field
curl -H "Authorization: Bearer $TOKEN" \
  "https://api.podio.com/item/app/30498191/filter?limit=10"
```

### Hypothesis 2: Empty podioitemid Values Incorrectly Cached
**Theory**: The prefetch cache built a cache with empty `podioitemid` values, but the normalization logic should skip empty values (0, false, "", null).

**Evidence Needed**:
1. Check target app for items with empty `podioitemid`
2. Review prefetch cache statistics from migration
3. Check if normalizeValue() correctly skipped empty values

**Code Reference**: `prefetch-cache.ts:220-239` - Empty values should be skipped during prefetch

### Hypothesis 3: Field Mapping Error
**Theory**: The `podioitemid` field (external_id) doesn't exist in source or target app, causing all items to have empty match values.

**Evidence Needed**:
1. Verify field with external_id=`podioitemid` exists in source app 24867474
2. Verify field with external_id=`podioitemid` exists in target app 30498191
3. Check field types (should be text or number)

**Validation Steps**:
```bash
# Get source app structure
curl -H "Authorization: Bearer $TOKEN" \
  "https://api.podio.com/app/24867474"

# Get target app structure
curl -H "Authorization: Bearer $TOKEN" \
  "https://api.podio.com/app/30498191"

# Search for podioitemid field in both
```

### Hypothesis 4: Normalization Bug
**Theory**: The normalization logic incorrectly matches all values (e.g., all empty values matching each other despite skip logic).

**Evidence Needed**:
1. Review prefetch cache hit rate statistics
2. Check if cache size = number of skipped items
3. Test normalizeForMatch() with sample podioitemid values

**Code Reference**: `prefetch-cache.ts:23-89` - normalizeValue() function

## Investigation Steps (Priority Order)

### Step 1: Verify Target App State (HIGH PRIORITY)
**Goal**: Determine if target app already contains the items

**Actions**:
1. Get item count for target app 30498191
2. Sample 100 items from target app
3. Check if `podioitemid` field exists and has values
4. Compare with source app item count (21,161)

**Expected Outcome**:
- If target has ~20,000+ items → Items already migrated (skip is correct)
- If target has 0 items → Bug in duplicate detection

### Step 2: Validate Field Configuration (HIGH PRIORITY)
**Goal**: Verify `podioitemid` field exists in both apps

**Actions**:
1. Fetch source app structure (24867474)
2. Fetch target app structure (30498191)
3. Search for field with external_id=`podioitemid`
4. Verify field type (should be text, number, or calculation)

**Expected Outcome**:
- Field exists in both apps → Continue to Step 3
- Field missing → Field mapping error (reconfigure migration)

### Step 3: Analyze Sample Data (MEDIUM PRIORITY)
**Goal**: Verify actual field values and normalization behavior

**Actions**:
1. Fetch 10 random items from source app
2. Extract `podioitemid` field values
3. Check if values are empty (null, "", 0, false)
4. Test normalizeForMatch() on sample values
5. Check if normalized values exist in prefetch cache

**Expected Outcome**:
- Values are empty → All items skipped correctly (need different match field)
- Values are unique → Cache lookup bug

### Step 4: Review Prefetch Cache Statistics (MEDIUM PRIORITY)
**Goal**: Analyze cache behavior during migration

**Actions**:
1. Check if migration logs exist (not found earlier - may need to re-run with logging)
2. Look for cache statistics in console output
3. Check cache size vs items skipped correlation

**Expected Outcome**:
- Cache size ≈ items skipped → Cache working correctly
- Cache size << items skipped → Normalization bug

### Step 5: Test Normalization Logic (LOW PRIORITY)
**Goal**: Verify normalizeForMatch() works correctly for podioitemid values

**Actions**:
1. Create unit test with sample podioitemid values
2. Test empty value handling (null, "", 0)
3. Test number vs string matching (123 vs "123")
4. Test whole number normalization (123.0 vs 123)

**Expected Outcome**:
- Tests pass → Normalization working correctly
- Tests fail → Bug in normalizeValue()

## Recommended Immediate Actions

### Action 1: Quick Diagnostic Query
**Run this to get immediate insights**:

```typescript
// Check target app state
const targetCount = await fetchItemCount(client, 30498191);
console.log('Target app item count:', targetCount);

// Get source app structure
const sourceApp = await getAppStructure(24867474);
const podioItemIdField = sourceApp.fields.find(f => f.external_id === 'podioitemid');
console.log('Source podioitemid field:', podioItemIdField);

// Get target app structure
const targetApp = await getAppStructure(30498191);
const targetPodioItemIdField = targetApp.fields.find(f => f.external_id === 'podioitemid');
console.log('Target podioitemid field:', targetPodioItemIdField);

// Sample source items
const sourceItems = await fetchFirstNItems(24867474, 10);
const podioItemIdValues = sourceItems.map(item => {
  const field = item.fields.find(f => f.external_id === 'podioitemid');
  const value = extractFieldValue(field);
  return {
    itemId: item.item_id,
    rawValue: value,
    normalizedValue: normalizeForMatch(value)
  };
});
console.log('Sample podioitemid values:', podioItemIdValues);
```

### Action 2: Migration Decision Matrix

| Scenario | Next Step |
|----------|-----------|
| Target app has 20,000+ items with matching podioitemid | Migration already complete - mark as success |
| Target app is empty | Bug in duplicate detection - disable duplicate check and re-run |
| podioitemid field doesn't exist | Reconfigure migration with correct match field |
| podioitemid values are all empty | Use different match field (e.g., title, unique ID) |
| Normalization bug detected | Fix normalizeValue() logic and re-run |

## Success Criteria

**Investigation Complete When**:
1. ✅ Root cause identified with evidence
2. ✅ Decision made: fix bug OR reconfigure migration OR migration already complete
3. ✅ If bug: issue documented with reproduction steps
4. ✅ If reconfigure: new match field selected and validated
5. ✅ Migration state updated to reflect actual outcome

## Code References

- **Prefetch Cache**: `lib/migration/items/prefetch-cache.ts:170-281`
- **Normalization Logic**: `lib/migration/items/prefetch-cache.ts:23-89`
- **Duplicate Detection**: `lib/migration/items/item-migrator.ts:685-820`
- **Migration State**: `data/migrations/a447ecda-d38e-442c-bb93-cee9c8f155e4.json`

## Notes for Agent

- Migration is still "in_progress" (98% complete) - may need to cancel/complete it
- No logs found in `logs/migrations/a447ecda-d38e-442c-bb93-cee9c8f155e4/` - may have been lost
- The prefetch cache system was recently improved (PR #2) - this migration may have run before/after that change
- Check git log to see if migration ran before or after the duplicate check improvements

## Expected Time Investment
- Quick diagnostic: 5-10 minutes
- Full investigation: 30-45 minutes
- Bug fix (if needed): 1-2 hours
- Re-run migration (if needed): 1-2 hours (depending on item count)
