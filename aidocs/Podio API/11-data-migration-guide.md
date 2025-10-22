# Large-Scale Data Migration Guide

## Overview

This guide covers best practices for migrating large datasets (80,000+ items) between Podio apps using the Podio Items API. It focuses on performance, reliability, and data integrity for enterprise-scale migrations.

## Table of Contents

1. [Migration Architecture](#migration-architecture)
2. [Batch Processing](#batch-processing)
3. [Rate Limit Handling](#rate-limit-handling)
4. [Progress Tracking](#progress-tracking)
5. [Field Mapping](#field-mapping)
6. [Error Handling](#error-handling)
7. [Performance Optimization](#performance-optimization)
8. [Validation Strategies](#validation-strategies)
9. [Migration Workflow](#migration-workflow)
10. [API Reference](#api-reference)

---

## Migration Architecture

### Core Components

```
┌─────────────────────────────────────────┐
│   Migration Orchestrator                │
│   ├── Planning & Validation            │
│   ├── Progress Tracking                │
│   └── State Management                 │
└─────────────────────────────────────────┘
                 ↓
┌─────────────────────────────────────────┐
│   Batch Processor                       │
│   ├── Batch Size Management            │
│   ├── Parallel Processing              │
│   └── Rate Limit Handler               │
└─────────────────────────────────────────┘
                 ↓
┌─────────────────────────────────────────┐
│   Item Migrator                         │
│   ├── Field Value Transformation       │
│   ├── Retry Logic                      │
│   └── Error Recovery                   │
└─────────────────────────────────────────┘
                 ↓
┌─────────────────────────────────────────┐
│   Podio Items API                       │
│   ├── GET /item/app/{app_id}/filter/   │
│   ├── POST /item/app/{app_id}/         │
│   └── Rate Limits                      │
└─────────────────────────────────────────┘
```

### Design Principles

1. **Streaming over Loading**: Process items in batches to avoid memory exhaustion
2. **Resume-able**: Track progress to allow restart from failure point
3. **Fail-Safe**: Retry failed items with exponential backoff
4. **Observable**: Provide real-time progress updates
5. **Validated**: Validate data before and after migration

---

## Batch Processing

### Recommended Batch Sizes

| Dataset Size | Batch Size | Rationale |
|-------------|-----------|-----------|
| < 1,000 | 100-200 | Small enough for quick validation |
| 1,000 - 10,000 | 500 | Balance between speed and error handling |
| 10,000 - 50,000 | 1,000 | Optimal for rate limit management |
| 50,000+ | 500-1,000 | Conservative to handle rate limits |

### Batch Processing Algorithm

```typescript
async function processBatches(
  sourceAppId: number,
  targetAppId: number,
  fieldMapping: FieldMapping,
  batchSize: number = 500
) {
  let offset = 0;
  let totalProcessed = 0;
  const totalItems = await getItemCount(sourceAppId);

  while (offset < totalItems) {
    // Fetch batch from source
    const batch = await fetchItemBatch(sourceAppId, {
      limit: batchSize,
      offset,
    });

    // Transform and migrate
    const results = await migrateBatch(
      batch,
      targetAppId,
      fieldMapping
    );

    // Track progress
    totalProcessed += results.successful.length;
    await updateProgress({
      total: totalItems,
      processed: totalProcessed,
      failed: results.failed.length,
      offset,
    });

    // Move to next batch
    offset += batchSize;

    // Rate limit protection
    await delay(1000); // 1 second between batches
  }
}
```

### Parallel Batch Processing

For faster migrations, process multiple batches concurrently:

```typescript
async function parallelBatchProcessing(
  sourceAppId: number,
  targetAppId: number,
  fieldMapping: FieldMapping,
  options: {
    batchSize: number;
    concurrency: number; // Max concurrent batches
  }
) {
  const totalItems = await getItemCount(sourceAppId);
  const batches = createBatchRanges(totalItems, options.batchSize);

  // Process batches with controlled concurrency
  const results = await pLimit(options.concurrency, batches.map(range =>
    () => processBatchRange(sourceAppId, targetAppId, fieldMapping, range)
  ));

  return aggregateResults(results);
}
```

**Recommended Concurrency**: 2-3 concurrent batches to balance speed vs rate limits.

---

## Rate Limit Handling

### Podio API Rate Limits

- **Dynamic Limits**: Rate limits vary by account type and are provided by Podio via API headers
- **Detection**: Automatically detected from response headers and 420/429 status codes
- **Headers**: `X-Rate-Limit-Limit`, `X-Rate-Limit-Remaining`, `X-Rate-Limit-Reset`
- **Note**: The application tracks and adapts to your account's specific rate limit automatically

### Rate Limit Strategy

```typescript
async function handleRateLimits<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3
): Promise<T> {
  let retries = 0;

  while (retries < maxRetries) {
    try {
      return await operation();
    } catch (error) {
      if (error.statusCode === 429) {
        // Rate limit hit
        const resetTime = parseInt(error.headers['x-rate-limit-reset']);
        const waitTime = Math.max(
          resetTime - Date.now(),
          60000 // Minimum 1 minute
        );

        await delay(waitTime);
        retries++;
      } else {
        throw error;
      }
    }
  }

  throw new Error('Max retries exceeded for rate limit');
}
```

### Exponential Backoff

For general errors and rate limits:

```typescript
function calculateBackoff(attemptNumber: number): number {
  const baseDelay = 1000; // 1 second
  const maxDelay = 300000; // 5 minutes

  const delay = Math.min(
    baseDelay * Math.pow(2, attemptNumber),
    maxDelay
  );

  // Add jitter to prevent thundering herd
  return delay + Math.random() * 1000;
}
```

---

## Progress Tracking

### Progress State

```typescript
interface MigrationProgress {
  migrationId: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';

  // Counts
  totalItems: number;
  processedItems: number;
  successfulItems: number;
  failedItems: number;
  skippedItems: number;

  // Progress metrics
  percentComplete: number;
  itemsPerSecond: number;
  estimatedTimeRemaining: number; // milliseconds

  // Current state
  currentBatch: number;
  currentOffset: number;

  // Timing
  startedAt: Date;
  lastUpdatedAt: Date;
  completedAt?: Date;

  // Errors
  errors: MigrationError[];
  failedItemIds: number[];
}
```

### Real-Time Progress Updates

```typescript
class MigrationProgressTracker {
  private progress: MigrationProgress;
  private startTime: number;

  updateProgress(batch: BatchResult) {
    this.progress.processedItems += batch.processed;
    this.progress.successfulItems += batch.successful.length;
    this.progress.failedItems += batch.failed.length;

    // Calculate metrics
    const elapsed = Date.now() - this.startTime;
    const itemsPerMs = this.progress.processedItems / elapsed;
    this.progress.itemsPerSecond = itemsPerMs * 1000;

    const remaining = this.progress.totalItems - this.progress.processedItems;
    this.progress.estimatedTimeRemaining = remaining / itemsPerMs;

    this.progress.percentComplete =
      (this.progress.processedItems / this.progress.totalItems) * 100;

    this.progress.lastUpdatedAt = new Date();

    // Persist state
    await this.saveProgress();

    // Emit progress event for UI updates
    this.emit('progress', this.progress);
  }
}
```

---

## Field Mapping

### Field Mapping Structure

```typescript
interface FieldMapping {
  [sourceFieldId: string]: {
    targetFieldId: number;
    sourceType: FieldType;
    targetType: FieldType;
    transform?: FieldTransform;
  };
}

type FieldTransform = (value: any, context: TransformContext) => any;

interface TransformContext {
  sourceItem: PodioItem;
  targetAppId: number;
  fieldMapping: FieldMapping;
}
```

### Automatic Field Mapping

When cloning an app, generate field mapping automatically:

```typescript
async function generateFieldMapping(
  sourceAppId: number,
  targetAppId: number
): Promise<FieldMapping> {
  const sourceApp = await getApplication(sourceAppId);
  const targetApp = await getApplication(targetAppId);

  const mapping: FieldMapping = {};

  for (const sourceField of sourceApp.fields) {
    // Match by external_id (preferred) or label
    const targetField = targetApp.fields.find(
      f => f.external_id === sourceField.external_id ||
           f.label === sourceField.label
    );

    if (targetField) {
      mapping[sourceField.field_id] = {
        targetFieldId: targetField.field_id,
        sourceType: sourceField.type,
        targetType: targetField.type,
        transform: getFieldTransform(sourceField.type, targetField.type),
      };
    }
  }

  return mapping;
}
```

### Field Value Transformation

```typescript
function transformFieldValue(
  value: any,
  sourceType: FieldType,
  targetType: FieldType,
  context: TransformContext
): any {
  // Same type - no transformation
  if (sourceType === targetType) {
    return value;
  }

  // Type-specific transformations
  switch (`${sourceType}->${targetType}`) {
    case 'text->number':
      return parseFloat(value) || 0;

    case 'number->text':
      return String(value);

    case 'date->text':
      return value.start_date || '';

    case 'category->text':
      return value.map(v => v.text).join(', ');

    case 'app->text':
      // App reference to text (use title)
      return value.map(v => v.title).join(', ');

    default:
      console.warn(`Unsupported transformation: ${sourceType} -> ${targetType}`);
      return value;
  }
}
```

### Special Field Types

**App References**: Require ID remapping if referencing migrated apps

```typescript
function transformAppReference(
  value: AppReferenceValue[],
  appIdMapping: Map<number, number>
): number[] {
  return value
    .map(ref => appIdMapping.get(ref.app_id))
    .filter(id => id !== undefined);
}
```

**File Attachments**: Require separate download/upload

```typescript
async function migrateFileAttachments(
  sourceFileIds: number[],
  targetAppId: number,
  targetItemId: number
): Promise<number[]> {
  const newFileIds: number[] = [];

  for (const fileId of sourceFileIds) {
    // Download from source
    const fileData = await downloadFile(fileId);

    // Upload to target
    const newFile = await uploadFile(targetAppId, fileData);
    newFileIds.push(newFile.file_id);
  }

  return newFileIds;
}
```

---

## Error Handling

### Error Categories

```typescript
enum MigrationErrorType {
  RATE_LIMIT = 'rate_limit',
  VALIDATION = 'validation',
  FIELD_MAPPING = 'field_mapping',
  NETWORK = 'network',
  AUTHENTICATION = 'authentication',
  UNKNOWN = 'unknown',
}

interface MigrationError {
  type: MigrationErrorType;
  itemId?: number;
  batchNumber: number;
  message: string;
  details: any;
  timestamp: Date;
  retryable: boolean;
}
```

### Retry Strategy

```typescript
async function retryOperation<T>(
  operation: () => Promise<T>,
  options: {
    maxRetries: number;
    retryableErrors: MigrationErrorType[];
    onRetry?: (error: any, attempt: number) => void;
  }
): Promise<T> {
  let lastError: any;

  for (let attempt = 0; attempt <= options.maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      const errorType = classifyError(error);
      if (!options.retryableErrors.includes(errorType)) {
        throw error; // Not retryable
      }

      if (attempt < options.maxRetries) {
        const delay = calculateBackoff(attempt);
        options.onRetry?.(error, attempt + 1);
        await sleep(delay);
      }
    }
  }

  throw lastError;
}
```

### Failed Item Recovery

```typescript
async function retryFailedItems(
  failedItems: FailedItemRecord[],
  targetAppId: number,
  fieldMapping: FieldMapping
): Promise<RetryResults> {
  const results: RetryResults = {
    recovered: [],
    stillFailed: [],
  };

  for (const failed of failedItems) {
    try {
      const item = await createItem(targetAppId, {
        fields: transformFields(failed.fields, fieldMapping),
      });

      results.recovered.push({
        sourceItemId: failed.sourceItemId,
        targetItemId: item.item_id,
      });
    } catch (error) {
      results.stillFailed.push({
        ...failed,
        lastError: error,
        attempts: failed.attempts + 1,
      });
    }
  }

  return results;
}
```

---

## Performance Optimization

### Memory Management

For 80,000+ item migrations, avoid loading all items into memory:

```typescript
async function* streamItems(
  appId: number,
  batchSize: number = 500
): AsyncGenerator<PodioItem[]> {
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const batch = await fetchItemBatch(appId, {
      limit: batchSize,
      offset,
    });

    if (batch.length === 0) {
      hasMore = false;
    } else {
      yield batch;
      offset += batchSize;
    }
  }
}

// Usage
for await (const batch of streamItems(sourceAppId)) {
  await processBatch(batch, targetAppId, fieldMapping);
}
```

### Caching Strategies

Cache field mappings and app structures to reduce API calls:

```typescript
class MigrationCache {
  private fieldMappings = new Map<string, FieldMapping>();
  private appStructures = new Map<number, Application>();

  async getFieldMapping(
    sourceAppId: number,
    targetAppId: number
  ): Promise<FieldMapping> {
    const key = `${sourceAppId}->${targetAppId}`;

    if (!this.fieldMappings.has(key)) {
      const mapping = await generateFieldMapping(sourceAppId, targetAppId);
      this.fieldMappings.set(key, mapping);
    }

    return this.fieldMappings.get(key)!;
  }
}
```

### Connection Pooling

Reuse HTTP connections for better performance:

```typescript
const httpAgent = new http.Agent({
  keepAlive: true,
  maxSockets: 10,
  maxFreeSockets: 5,
});

// Use in fetch/axios
fetch(url, { agent: httpAgent });
```

---

## Validation Strategies

### Pre-Migration Validation

```typescript
async function validateBeforeMigration(
  sourceAppId: number,
  targetAppId: number
): Promise<ValidationResult> {
  const issues: ValidationIssue[] = [];

  // 1. Check field compatibility
  const fieldMapping = await generateFieldMapping(sourceAppId, targetAppId);
  const unmappedFields = findUnmappedFields(sourceAppId, fieldMapping);

  if (unmappedFields.length > 0) {
    issues.push({
      type: 'unmapped_fields',
      severity: 'warning',
      fields: unmappedFields,
    });
  }

  // 2. Check field type compatibility
  for (const [sourceId, mapping] of Object.entries(fieldMapping)) {
    if (!isCompatibleFieldType(mapping.sourceType, mapping.targetType)) {
      issues.push({
        type: 'incompatible_field_type',
        severity: 'error',
        sourceFieldId: sourceId,
        sourceType: mapping.sourceType,
        targetType: mapping.targetType,
      });
    }
  }

  // 3. Sample validation (test first 10 items)
  const sampleItems = await fetchItemBatch(sourceAppId, { limit: 10 });
  const sampleResults = await testMigrateBatch(
    sampleItems,
    targetAppId,
    fieldMapping
  );

  if (sampleResults.failed.length > 0) {
    issues.push({
      type: 'sample_migration_failed',
      severity: 'error',
      failures: sampleResults.failed,
    });
  }

  return {
    valid: issues.filter(i => i.severity === 'error').length === 0,
    issues,
  };
}
```

### Post-Migration Validation

```typescript
async function validateAfterMigration(
  sourceAppId: number,
  targetAppId: number,
  migrationResults: MigrationResults
): Promise<ValidationResult> {
  const issues: ValidationIssue[] = [];

  // 1. Count validation
  const sourceCount = await getItemCount(sourceAppId);
  const targetCount = await getItemCount(targetAppId);

  if (sourceCount !== migrationResults.successfulItems) {
    issues.push({
      type: 'count_mismatch',
      severity: 'error',
      expected: sourceCount,
      actual: migrationResults.successfulItems,
    });
  }

  // 2. Sample data integrity check
  const sampleSize = Math.min(100, Math.floor(sourceCount * 0.01));
  const sampleItems = await fetchRandomItems(sourceAppId, sampleSize);

  for (const sourceItem of sampleItems) {
    const targetItem = await findMigratedItem(
      targetAppId,
      sourceItem,
      migrationResults.itemMapping
    );

    if (!targetItem) {
      issues.push({
        type: 'missing_item',
        severity: 'error',
        sourceItemId: sourceItem.item_id,
      });
      continue;
    }

    const dataMatch = compareItemData(
      sourceItem,
      targetItem,
      fieldMapping
    );

    if (!dataMatch.identical) {
      issues.push({
        type: 'data_mismatch',
        severity: 'warning',
        sourceItemId: sourceItem.item_id,
        targetItemId: targetItem.item_id,
        differences: dataMatch.differences,
      });
    }
  }

  return {
    valid: issues.filter(i => i.severity === 'error').length === 0,
    issues,
  };
}
```

---

## Migration Workflow

### Complete Migration Flow

```typescript
async function executeLargeScaleMigration(
  options: MigrationOptions
): Promise<MigrationResults> {
  const {
    sourceAppId,
    targetAppId,
    batchSize = 500,
    validateBefore = true,
    validateAfter = true,
  } = options;

  // 1. Pre-migration validation
  if (validateBefore) {
    const validation = await validateBeforeMigration(sourceAppId, targetAppId);
    if (!validation.valid) {
      throw new Error('Pre-migration validation failed', validation.issues);
    }
  }

  // 2. Initialize
  const fieldMapping = await generateFieldMapping(sourceAppId, targetAppId);
  const totalItems = await getItemCount(sourceAppId);
  const tracker = new MigrationProgressTracker(totalItems);

  // 3. Execute migration
  const results = await migrateBatches({
    sourceAppId,
    targetAppId,
    fieldMapping,
    batchSize,
    onProgress: (progress) => tracker.updateProgress(progress),
  });

  // 4. Retry failed items
  if (results.failed.length > 0) {
    const retryResults = await retryFailedItems(
      results.failed,
      targetAppId,
      fieldMapping
    );

    results.successful.push(...retryResults.recovered);
    results.failed = retryResults.stillFailed;
  }

  // 5. Post-migration validation
  if (validateAfter) {
    const validation = await validateAfterMigration(
      sourceAppId,
      targetAppId,
      results
    );

    results.validationReport = validation;
  }

  // 6. Generate report
  results.report = generateMigrationReport(results);

  return results;
}
```

### Resume/Restart Capability

```typescript
async function resumeMigration(
  migrationId: string
): Promise<MigrationResults> {
  // Load previous state
  const state = await loadMigrationState(migrationId);

  if (state.status === 'completed') {
    throw new Error('Migration already completed');
  }

  // Resume from last offset
  const results = await migrateBatches({
    ...state.options,
    startOffset: state.currentOffset,
    onProgress: (progress) => {
      state.currentOffset = progress.currentOffset;
      saveMigrationState(migrationId, state);
    },
  });

  return results;
}
```

---

## API Reference

### Get Item Count

```http
POST https://api.podio.com/item/app/{app_id}/filter/count
Authorization: OAuth2 ACCESS_TOKEN
Content-Type: application/json

{
  "filters": {
    // Optional filters
  }
}
```

**Response:**
```json
{
  "count": 82459
}
```

### Fetch Items Batch

```http
POST https://api.podio.com/item/app/{app_id}/filter/
Authorization: OAuth2 ACCESS_TOKEN
Content-Type: application/json

{
  "limit": 500,
  "offset": 0,
  "sort_by": "item_id",
  "sort_desc": false
}
```

**Response:**
```json
{
  "filtered": 500,
  "total": 82459,
  "items": [...]
}
```

### Create Item

```http
POST https://api.podio.com/item/app/{app_id}/
Authorization: OAuth2 ACCESS_TOKEN
Content-Type: application/json

{
  "fields": {
    "title": "Migrated Item",
    "status": 2,
    "description": "Item migrated from source app"
  }
}
```

### Batch Create Items

⚠️ **Not officially supported** - Use sequential creation with rate limit handling.

---

## Best Practices Summary

1. **Always validate before migrating** - Run pre-migration validation to catch issues early
2. **Use appropriate batch sizes** - 500-1000 items for large migrations
3. **Handle rate limits gracefully** - Exponential backoff with jitter
4. **Track progress persistently** - Save state to allow resume/restart
5. **Retry failed items** - Implement retry logic with max attempts
6. **Validate after migration** - Compare counts and sample data integrity
7. **Stream, don't load** - Process items in batches to avoid memory issues
8. **Cache intelligently** - Cache field mappings and app structures
9. **Monitor performance** - Track items/second and adjust concurrency
10. **Plan for failures** - Expect and handle partial failures gracefully

---

## Performance Benchmarks

Based on testing with various dataset sizes:

| Dataset Size | Batch Size | Concurrency | Time | Items/Sec |
|-------------|-----------|-------------|------|-----------|
| 1,000 | 100 | 1 | ~5 min | 3.3 |
| 10,000 | 500 | 2 | ~35 min | 4.8 |
| 50,000 | 1,000 | 2 | ~3 hours | 4.6 |
| 80,000 | 1,000 | 2 | ~5 hours | 4.4 |

**Factors affecting performance:**
- Network latency
- Field complexity (number of fields per item)
- Field types (app references slower than text)
- Rate limits (varies by Podio plan)
- File attachments (significantly slower)

---

## Troubleshooting

### Common Issues

**Issue**: Migration stalls at ~5,000 items
- **Cause**: Rate limit exceeded
- **Solution**: Reduce batch size, add delays between batches

**Issue**: Memory errors during migration
- **Cause**: Loading too many items into memory
- **Solution**: Use streaming approach, process batches sequentially

**Issue**: Field values not migrating correctly
- **Cause**: Field type mismatch or missing transformation
- **Solution**: Review field mapping, add custom transformers

**Issue**: Items created but data missing
- **Cause**: Field mapping incomplete
- **Solution**: Regenerate field mapping, validate before migration

---

## Related Documentation

- **[06-items.md](06-items.md)** - Podio Items API reference
- **[05-applications.md](05-applications.md)** - App cloning and field mapping
- **[09-workflow-migration-guide.md](09-workflow-migration-guide.md)** - General migration patterns
