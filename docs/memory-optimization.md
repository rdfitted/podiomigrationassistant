# Memory Optimization Guide

## Overview

This document describes the memory optimizations implemented to prevent memory issues during long-running migrations.

## Problem

For large migrations (10,000+ items), the server was experiencing memory issues, particularly:
- Next.js Turbopack warning: "Server is approaching the used memory threshold, restarting..."
- Memory exhaustion during prefetch cache loading
- Memory buildup during long-running batch processing

## Root Cause

The primary memory consumer was the **PrefetchCache** (`lib/migration/items/prefetch-cache.ts`), which:
1. Loaded ALL target items into memory upfront
2. Stored complete `PodioItem` objects (with all fields, metadata, nested objects)
3. For apps with 10,000+ items, this consumed hundreds of MB of memory

## Solutions Implemented

### 1. Slim Cache Entries (~90% Memory Reduction)

**Before:**
```typescript
interface CacheEntry {
  value: PodioItem;           // Complete item with all fields
  createdAt: Date;            // Full Date object
  lastAccessedAt: Date;       // Full Date object
  appId?: number;
}
```

**After:**
```typescript
interface SlimCacheEntry {
  itemId: number;            // Only the item ID (sufficient for duplicate detection)
  matchValue: unknown;       // Match field value (for debugging)
  createdAt: number;         // Timestamp instead of Date object
  appId?: number;
}
```

**Impact:**
- For 10,000 items: ~900 MB → ~90 MB memory usage
- Only stores essential data needed for duplicate detection

### 2. Memory Monitoring

New `MemoryMonitor` class (`lib/migration/memory-monitor.ts`) provides:
- Continuous memory tracking during migrations
- Warning at 75% heap usage
- Critical alert at 85% heap usage
- Automatic garbage collection at critical threshold

**Usage:**
```typescript
const monitor = new MemoryMonitor({
  warningThreshold: 75,
  criticalThreshold: 85,
  checkInterval: 30000,  // Check every 30 seconds
  autoGC: true
});
monitor.start('migration:jobId');
```

### 3. Periodic Garbage Collection

Batch processor now triggers GC:
- Every 10 batches
- Only when heap usage > 70%
- Prevents gradual memory buildup

### 4. Migration Lifecycle GC

The migration runner now:
- Logs memory usage at start and end
- Starts memory monitoring for the entire migration
- Forces GC after migration completion
- Stops monitoring on cleanup

### 5. Post-Prefetch GC

After loading the prefetch cache:
- If estimated memory > 100 MB, trigger GC
- Cleans up temporary objects from streaming

## Running with GC Support

To enable automatic garbage collection, run with the `--expose-gc` flag:

```bash
# Development (GC enabled by default)
npm run dev

# Development without GC
npm run dev:no-gc

# Production (GC enabled by default)
npm run start

# Production without GC
npm run start:no-gc
```

The scripts automatically set `NODE_OPTIONS='--expose-gc'` for better memory management.

## Memory Usage Estimates

| App Size | Old Cache Size | New Cache Size | Reduction |
|----------|---------------|----------------|-----------|
| 1,000    | ~90 MB        | ~9 MB          | 90%       |
| 10,000   | ~900 MB       | ~90 MB         | 90%       |
| 50,000   | ~4.5 GB       | ~450 MB        | 90%       |

**Note:** Estimates assume average item size with 10 fields. Actual usage may vary.

## Monitoring Memory

### Logs

Memory statistics are logged at:
- Migration start: `migration_start`
- Migration end: `migration_end`
- Every 30 seconds during migration (debug level)
- Warning/critical thresholds

Example log:
```json
{
  "level": "info",
  "message": "Memory usage",
  "context": "migration_start",
  "heapUsedMB": 145.32,
  "heapTotalMB": 256.00,
  "heapUsedPercent": 56.77,
  "rssMB": 234.12
}
```

### Cache Statistics

Prefetch cache now includes memory estimates:
```json
{
  "level": "info",
  "message": "Pre-fetch complete",
  "totalCached": 10000,
  "estimatedMemoryMB": 87.5
}
```

## Best Practices

1. **Always run with `--expose-gc`** for production migrations
2. **Monitor logs** for memory warnings during large migrations
3. **Reduce batch size** if you see critical memory warnings
4. **Clear old jobs** periodically to free up state store memory

## API Changes

### PrefetchCache

**New method (recommended):**
```typescript
const itemId = cache.getExistingItemId(matchValue);
// Returns: number | null
```

**Legacy method (deprecated):**
```typescript
const item = cache.getExistingItem(matchValue);
// Returns: PodioItem | null (minimal stub)
```

The `item-migrator` has been updated to use `getExistingItemId()` for memory efficiency.

## Troubleshooting

### Still seeing memory issues?

1. **Check heap size:** Add `--max-old-space-size=4096` to NODE_OPTIONS for 4GB heap
2. **Reduce batch size:** Lower from 500 to 250 or 100
3. **Reduce concurrency:** Lower from 5 to 3
4. **Enable manual GC:** Ensure `--expose-gc` is set
5. **Check cache TTL:** Default is 12 hours; reduce if needed

### Memory warnings not appearing?

1. Ensure memory monitor is started (check logs for "Starting memory monitor")
2. Check that `--expose-gc` is enabled
3. Verify migration is using `runItemMigrationJob()` (not old code paths)

## Performance Impact

The memory optimizations have minimal performance impact:
- Cache lookups: Still O(1)
- GC triggers: Only when memory > 70%
- Monitoring: Every 30 seconds (negligible CPU)

## Future Improvements

Possible enhancements:
- Implement LRU eviction for 100K+ item caches
- Add cache streaming/chunking for 100K+ items
- Compress match values in cache
- Add memory profiling endpoints
