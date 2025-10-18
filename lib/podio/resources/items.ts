import { PodioHttpClient } from '../http/client';
import { logger } from '../logging';
import { withRetry, createRetryConfig } from '../http/retry';

/**
 * Item field value types
 */
export interface PodioFieldValue {
  value: unknown;
  start?: string;
  end?: string;
  type?: string; // For phone/email fields (mobile, work, home, etc.)
  currency?: string; // For money fields
  [key: string]: unknown;
}

/**
 * Podio item field
 */
export interface PodioItemField {
  field_id: number;
  external_id: string;
  type: string;
  label: string;
  values: PodioFieldValue[];
  config?: {
    settings?: Record<string, unknown>;
    required?: boolean;
    [key: string]: unknown;
  };
}

/**
 * Podio item
 */
export interface PodioItem {
  item_id: number;
  app_item_id: number;
  app: {
    app_id: number;
    config: {
      name: string;
      [key: string]: unknown;
    };
  };
  fields: PodioItemField[];
  external_id?: string;
  created_on: string;
  created_by: {
    user_id: number;
    name: string;
  };
  link: string;
  rights: string[];
}

/**
 * Item filter request
 */
export interface ItemFilterRequest {
  filters?: Record<string, unknown>;
  sort_by?: string;
  sort_desc?: boolean;
  limit?: number;
  offset?: number;
}

/**
 * Item filter response
 */
export interface ItemFilterResponse {
  filtered: number;
  total: number;
  items: PodioItem[];
}

/**
 * Create item request
 */
export interface CreateItemRequest {
  fields: Record<string, unknown>;
  external_id?: string;
  tags?: string[];
  file_ids?: number[];
  reminder?: {
    remind_delta: number;
  };
}

/**
 * Create item response
 */
export interface CreateItemResponse {
  item_id: number;
  app_item_id: number;
  title: string;
  link: string;
  revision: number;
}

/**
 * Get a single item by ID
 */
export async function getItem(
  client: PodioHttpClient,
  itemId: number
): Promise<PodioItem> {
  logger.info('Getting item', { itemId });

  try {
    const response = await client.get<PodioItem>(`/item/${itemId}`);
    logger.info('Retrieved item', { itemId, appId: response.app.app_id });
    return response;
  } catch (error) {
    logger.error('Failed to get item', { itemId, error });
    throw error;
  }
}

/**
 * Get an item by app item ID
 */
export async function getItemByAppItemId(
  client: PodioHttpClient,
  appId: number,
  appItemId: number
): Promise<PodioItem> {
  logger.info('Getting item by app item ID', { appId, appItemId });

  try {
    const response = await client.get<PodioItem>(`/app/${appId}/item/${appItemId}`);
    logger.info('Retrieved item by app item ID', { itemId: response.item_id });
    return response;
  } catch (error) {
    logger.error('Failed to get item by app item ID', { appId, appItemId, error });
    throw error;
  }
}

/**
 * Fetch multiple items by their IDs
 * Useful for retry operations where we need to fetch specific failed items
 */
export async function fetchItemsByIds(
  client: PodioHttpClient,
  itemIds: number[]
): Promise<PodioItem[]> {
  logger.info('Fetching items by IDs', { itemCount: itemIds.length });

  if (itemIds.length === 0) {
    return [];
  }

  try {
    // Fetch items concurrently in batches to avoid overwhelming the API
    const batchSize = 50; // Fetch 50 items at a time
    const batches: number[][] = [];

    for (let i = 0; i < itemIds.length; i += batchSize) {
      batches.push(itemIds.slice(i, i + batchSize));
    }

    const items: PodioItem[] = [];

    for (const batch of batches) {
      const batchItems = await Promise.all(
        batch.map(async (itemId) => {
          try {
            return await getItem(client, itemId);
          } catch (error) {
            logger.warn('Failed to fetch item by ID', { itemId, error });
            return null;
          }
        })
      );

      // Filter out null results (failed fetches)
      items.push(...batchItems.filter((item): item is PodioItem => item !== null));
    }

    logger.info('Fetched items by IDs', {
      requestedCount: itemIds.length,
      fetchedCount: items.length,
      failedCount: itemIds.length - items.length,
    });

    return items;
  } catch (error) {
    logger.error('Failed to fetch items by IDs', { itemIds, error });
    throw error;
  }
}

/**
 * Filter items in an app
 */
export async function filterItems(
  client: PodioHttpClient,
  appId: number,
  filter: ItemFilterRequest = {}
): Promise<ItemFilterResponse> {
  logger.info('Filtering items', { appId, filter });

  try {
    // Add fields parameter to get full item details including all calculation fields
    const response = await client.post<ItemFilterResponse>(
      `/item/app/${appId}/filter/?fields=items.view(full)`,
      filter
    );
    logger.info('Filtered items', {
      appId,
      filtered: response.filtered,
      total: response.total,
      returned: response.items.length,
    });
    return response;
  } catch (error) {
    logger.error('Failed to filter items', { appId, filter, error });
    throw error;
  }
}

/**
 * Get all items from an app (handles pagination)
 */
export async function getAllItems(
  client: PodioHttpClient,
  appId: number,
  batchSize = 500
): Promise<PodioItem[]> {
  logger.info('Getting all items', { appId, batchSize });

  const allItems: PodioItem[] = [];
  let offset = 0;
  let hasMore = true;

  try {
    while (hasMore) {
      const response = await filterItems(client, appId, {
        limit: batchSize,
        offset,
      });

      allItems.push(...response.items);
      offset += batchSize;
      hasMore = response.filtered > offset;
    }

    logger.info('Retrieved all items', { appId, totalItems: allItems.length });
    return allItems;
  } catch (error) {
    logger.error('Failed to get all items', { appId, error });
    throw error;
  }
}

/**
 * Create a new item in an app
 *
 * @param client - Podio HTTP client
 * @param appId - App ID to create item in
 * @param request - Item creation request data
 * @param options - Additional options
 * @param options.hook - Whether to trigger webhooks (default: true to enable Globiflow/hooks)
 * @param options.silent - Whether to suppress notifications (default: false)
 */
export async function createItem(
  client: PodioHttpClient,
  appId: number,
  request: CreateItemRequest,
  options: {
    hook?: boolean;
    silent?: boolean;
  } = {}
): Promise<CreateItemResponse> {
  const { hook = true, silent = false } = options;

  logger.info('Creating item', {
    appId,
    externalId: request.external_id,
    hookEnabled: hook,
    silent,
  });

  try {
    // Build URL with query parameters
    const queryParams = new URLSearchParams();
    queryParams.set('hook', String(hook));
    if (silent) {
      queryParams.set('silent', 'true');
    }

    const url = `/item/app/${appId}/?${queryParams.toString()}`;

    const response = await client.post<CreateItemResponse>(
      url,
      request
    );
    logger.info('Created item', {
      appId,
      itemId: response.item_id,
      appItemId: response.app_item_id,
      hookEnabled: hook,
    });
    return response;
  } catch (error) {
    logger.error('Failed to create item', { appId, request, error });
    throw error;
  }
}

/**
 * Update an existing item
 *
 * @param client - Podio HTTP client
 * @param itemId - Item ID to update
 * @param fields - Field values to update
 * @param options - Additional options
 * @param options.hook - Whether to trigger webhooks (default: true to enable Globiflow/hooks)
 * @param options.silent - Whether to suppress notifications (default: false)
 */
export async function updateItem(
  client: PodioHttpClient,
  itemId: number,
  fields: Record<string, unknown>,
  options: {
    hook?: boolean;
    silent?: boolean;
  } = {}
): Promise<{ revision: number }> {
  const { hook = true, silent = false } = options;

  logger.info('Updating item', {
    itemId,
    hookEnabled: hook,
    silent,
  });

  try {
    // Build URL with query parameters
    const queryParams = new URLSearchParams();
    queryParams.set('hook', String(hook));
    if (silent) {
      queryParams.set('silent', 'true');
    }

    const url = `/item/${itemId}?${queryParams.toString()}`;

    const response = await client.put<{ revision: number }>(
      url,
      { fields }
    );
    logger.info('Updated item', {
      itemId,
      revision: response.revision,
      hookEnabled: hook,
    });
    return response;
  } catch (error) {
    logger.error('Failed to update item', { itemId, fields, error });
    throw error;
  }
}

/**
 * Delete an item
 */
export async function deleteItem(
  client: PodioHttpClient,
  itemId: number
): Promise<void> {
  logger.info('Deleting item', { itemId });

  try {
    await client.delete(`/item/${itemId}`);
    logger.info('Deleted item', { itemId });
  } catch (error) {
    logger.error('Failed to delete item', { itemId, error });
    throw error;
  }
}

/**
 * Extract field value from a Podio item field based on field type
 */
export function extractFieldValue(field: PodioItemField): unknown {
  if (!field.values || field.values.length === 0) {
    return null;
  }

  const value = field.values[0];

  switch (field.type) {
    case 'text':
    case 'number':
      return value.value;

    case 'date':
      return { start: value.start, end: value.end };

    case 'category':
      return field.values.map((v: PodioFieldValue) => (v.value as { id: number }).id);

    case 'app':
      return field.values.map((v: PodioFieldValue) => (v.value as { item_id: number }).item_id);

    case 'contact':
      return field.values.map((v: PodioFieldValue) => {
        const contact = v.value as { profile_id?: number; user_id?: number };
        return contact.profile_id || contact.user_id;
      });

    case 'money':
      return {
        value: (value.value as { value: number }).value || value.value,
        currency: (value as { currency?: string }).currency || 'USD',
      };

    case 'location':
      return value.value;

    case 'duration':
      return value.value;

    case 'question':
      return value.value;

    case 'phone':
    case 'tel':
      // Phone/Tel fields require type (mobile, work, home, etc.) and value
      // Preserve the full structure from source, including type
      return field.values.map((v: PodioFieldValue) => {
        // If value already has type and value properties, preserve them
        if (v.type && v.value) {
          return {
            type: v.type as string,
            value: typeof v.value === 'string' ? v.value : String(v.value || ''),
          };
        }
        // Fallback: default to 'mobile' type
        return {
          type: 'mobile',
          value: typeof v.value === 'string' ? v.value : String(v.value || ''),
        };
      });

    case 'email':
      // Email fields require type (work, home, other) and value
      // Preserve the full structure from source, including type
      return field.values.map((v: PodioFieldValue) => {
        // If value already has type and value properties, preserve them
        if (v.type && v.value) {
          return {
            type: v.type as string,
            value: typeof v.value === 'string' ? v.value : String(v.value || ''),
          };
        }
        // Fallback: default to 'work' type
        return {
          type: 'work',
          value: typeof v.value === 'string' ? v.value : String(v.value || ''),
        };
      });

    case 'calculation':
      // Calculation/formula fields - extract the computed value
      // These can be mapped to writable fields (e.g., text fields) in the target app
      return value.value;

    default:
      return value.value;
  }
}

/**
 * Map item fields using a field mapping
 * Automatically filters out read-only system fields (created_on, created_by, created_via)
 * Note: Calculation field VALUES are extracted and can be mapped to writable target fields
 */
export function mapItemFields(
  item: PodioItem,
  fieldMapping: Record<string, string>
): Record<string, unknown> {
  const mappedFields: Record<string, unknown> = {};

  // Read-only field types that cannot be set via API
  // NOTE: 'calculation' is intentionally excluded because we want to extract
  // VALUES from calculation fields and map them to writable target fields
  const readOnlyFieldTypes = [
    'created_on',      // Creation timestamp (system field)
    'created_by',      // Creator (system field)
    'created_via',     // Creation method (system field)
  ];

  for (const field of item.fields) {
    const targetExternalId = fieldMapping[field.external_id];

    // Skip if no mapping for this field
    if (!targetExternalId) {
      continue;
    }

    // Skip if source field is a read-only system field
    // Note: We allow extracting values from calculation fields since those
    // values can be written to writable target fields (e.g., text fields)
    if (readOnlyFieldTypes.includes(field.type)) {
      logger.debug('Skipping read-only system field during mapping', {
        fieldExternalId: field.external_id,
        fieldType: field.type,
        targetFieldExternalId: targetExternalId,
      });
      continue;
    }

    // Skip if no values
    if (!field.values || field.values.length === 0) {
      continue;
    }

    // Map the field
    mappedFields[targetExternalId] = extractFieldValue(field);
  }

  return mappedFields;
}

/**
 * Create a simple test item with minimal field values
 */
export async function createTestItem(
  client: PodioHttpClient,
  appId: number,
  testData?: Record<string, unknown>
): Promise<CreateItemResponse> {
  logger.info('Creating test item', { appId });

  // Use provided test data or create empty item
  const fields = testData || {};

  try {
    const response = await createItem(client, appId, {
      fields,
      external_id: `test-${Date.now()}`,
    });

    logger.info('Created test item', {
      appId,
      itemId: response.item_id,
      appItemId: response.app_item_id,
    });

    return response;
  } catch (error) {
    logger.error('Failed to create test item', { appId, testData, error });
    throw error;
  }
}

// ============================================================================
// PHASE 5: Large-Scale Data Migration Operations
// ============================================================================

/**
 * Streaming options for item iteration
 */
export interface StreamItemsOptions {
  /** Batch size for each API call (default: 500) */
  batchSize?: number;
  /** Starting offset for pagination (default: 0) */
  offset?: number;
  /** Filter criteria */
  filters?: Record<string, unknown>;
  /** Sort field */
  sortBy?: string;
  /** Sort descending */
  sortDesc?: boolean;
}

/**
 * Stream items from an app using async generator
 * Memory-efficient iteration for large datasets (80,000+ items)
 *
 * @example
 * for await (const batch of streamItems(client, appId, { batchSize: 500 })) {
 *   for (const item of batch) {
 *     // Process each item
 *   }
 * }
 */
export async function* streamItems(
  client: PodioHttpClient,
  appId: number,
  options: StreamItemsOptions = {}
): AsyncGenerator<PodioItem[], void, unknown> {
  const {
    batchSize = 500,
    offset: startOffset = 0,
    filters,
    sortBy,
    sortDesc,
  } = options;

  let offset = startOffset;
  let hasMore = true;
  let totalFetched = 0;

  logger.info('Starting item stream', { appId, batchSize, startOffset });

  while (hasMore) {
    try {
      const response = await withRetry(
        () => filterItems(client, appId, {
          filters,
          sort_by: sortBy,
          sort_desc: sortDesc,
          limit: batchSize,
          offset,
        }),
        createRetryConfig({ maxAttempts: 3 }),
        { method: 'POST', url: `/item/app/${appId}/filter/` }
      );

      if (response.items.length > 0) {
        yield response.items;
        totalFetched += response.items.length;
      }

      offset += batchSize;
      hasMore = response.filtered > offset;

      logger.info('Streamed item batch', {
        appId,
        batchSize: response.items.length,
        offset,
        totalFetched,
        remaining: response.filtered - offset,
      });
    } catch (error) {
      logger.error('Failed to stream items', { appId, offset, error });
      throw error;
    }
  }

  logger.info('Item stream complete', { appId, totalFetched });
}

/**
 * Get total item count for an app
 * Quick metadata query for migration planning
 */
export async function fetchItemCount(
  client: PodioHttpClient,
  appId: number,
  filters?: Record<string, unknown>
): Promise<{ total: number; filtered: number }> {
  logger.info('Fetching item count', { appId, hasFilters: !!filters });

  try {
    const response = await withRetry(
      () => filterItems(client, appId, {
        filters,
        limit: 1, // Minimal fetch to get counts
        offset: 0,
      }),
      createRetryConfig({ maxAttempts: 3 }),
      { method: 'POST', url: `/item/app/${appId}/filter/` }
    );

    logger.info('Item count retrieved', {
      appId,
      total: response.total,
      filtered: response.filtered,
    });

    return {
      total: response.total,
      filtered: response.filtered,
    };
  } catch (error) {
    logger.error('Failed to fetch item count', { appId, error });
    throw error;
  }
}

/**
 * Bulk create result
 */
export interface BulkCreateResult {
  successful: CreateItemResponse[];
  failed: Array<{
    request: CreateItemRequest;
    error: string;
    index: number;
  }>;
  successCount: number;
  failureCount: number;
}

/**
 * Bulk create options
 */
export interface BulkCreateOptions {
  /** Maximum concurrent requests (default: 5) */
  concurrency?: number;
  /** Whether to stop on first error (default: false) */
  stopOnError?: boolean;
  /** Retry configuration */
  retryConfig?: Parameters<typeof createRetryConfig>[0];
  /** Whether to trigger webhooks/Globiflow (default: true) */
  hook?: boolean;
  /** Whether to suppress notifications (default: false) */
  silent?: boolean;
}

/**
 * Bulk create items with controlled concurrency and retry logic
 * Optimized for large-scale migrations (80,000+ items)
 */
export async function bulkCreateItems(
  client: PodioHttpClient,
  appId: number,
  requests: CreateItemRequest[],
  options: BulkCreateOptions = {}
): Promise<BulkCreateResult> {
  const {
    concurrency = 5,
    stopOnError = false,
    retryConfig,
    hook = true,
    silent = false,
  } = options;

  logger.info('Starting bulk create', {
    appId,
    itemCount: requests.length,
    concurrency,
    hookEnabled: hook,
    silent,
  });

  const result: BulkCreateResult = {
    successful: [],
    failed: [],
    successCount: 0,
    failureCount: 0,
  };

  // Process in batches with concurrency control
  for (let i = 0; i < requests.length; i += concurrency) {
    const batch = requests.slice(i, i + concurrency);
    const batchPromises = batch.map((request, batchIndex) => {
      const globalIndex = i + batchIndex;

      return withRetry(
        () => createItem(client, appId, request, { hook, silent }),
        createRetryConfig(retryConfig || { maxAttempts: 3 }),
        { method: 'POST', url: `/item/app/${appId}/` }
      )
        .then((response) => {
          result.successful.push(response);
          result.successCount++;
          return { success: true, response, index: globalIndex };
        })
        .catch((error) => {
          const errorMessage = error instanceof Error ? error.message : String(error);
          result.failed.push({
            request,
            error: errorMessage,
            index: globalIndex,
          });
          result.failureCount++;

          logger.warn('Failed to create item in batch', {
            appId,
            index: globalIndex,
            error: errorMessage,
          });

          return { success: false, error: errorMessage, index: globalIndex };
        });
    });

    const batchResults = await Promise.all(batchPromises);

    // Stop on first error if requested
    if (stopOnError && batchResults.some(r => !r.success)) {
      logger.warn('Stopping bulk create due to error', {
        appId,
        processed: i + batch.length,
        total: requests.length,
      });
      break;
    }

    logger.info('Bulk create batch complete', {
      appId,
      processed: Math.min(i + concurrency, requests.length),
      total: requests.length,
      successCount: result.successCount,
      failureCount: result.failureCount,
    });
  }

  logger.info('Bulk create complete', {
    appId,
    total: requests.length,
    successCount: result.successCount,
    failureCount: result.failureCount,
  });

  return result;
}

/**
 * Bulk update result
 */
export interface BulkUpdateResult {
  successful: Array<{ itemId: number; revision: number }>;
  failed: Array<{
    itemId: number;
    fields: Record<string, unknown>;
    error: string;
    index: number;
  }>;
  successCount: number;
  failureCount: number;
}

/**
 * Bulk update options
 */
export interface BulkUpdateOptions {
  /** Maximum concurrent requests (default: 5) */
  concurrency?: number;
  /** Whether to stop on first error (default: false) */
  stopOnError?: boolean;
  /** Retry configuration */
  retryConfig?: Parameters<typeof createRetryConfig>[0];
  /** Whether to trigger webhooks/Globiflow (default: true) */
  hook?: boolean;
  /** Whether to suppress notifications (default: false) */
  silent?: boolean;
}

/**
 * Bulk update items with controlled concurrency and retry logic
 */
export async function bulkUpdateItems(
  client: PodioHttpClient,
  updates: Array<{ itemId: number; fields: Record<string, unknown> }>,
  options: BulkUpdateOptions = {}
): Promise<BulkUpdateResult> {
  const {
    concurrency = 5,
    stopOnError = false,
    retryConfig,
    hook = true,
    silent = false,
  } = options;

  logger.info('Starting bulk update', {
    itemCount: updates.length,
    concurrency,
    hookEnabled: hook,
    silent,
  });

  const result: BulkUpdateResult = {
    successful: [],
    failed: [],
    successCount: 0,
    failureCount: 0,
  };

  // Process in batches with concurrency control
  for (let i = 0; i < updates.length; i += concurrency) {
    const batch = updates.slice(i, i + concurrency);
    const batchPromises = batch.map((update, batchIndex) => {
      const globalIndex = i + batchIndex;

      return withRetry(
        () => updateItem(client, update.itemId, update.fields, { hook, silent }),
        createRetryConfig(retryConfig || { maxAttempts: 3 }),
        { method: 'PUT', url: `/item/${update.itemId}` }
      )
        .then((response) => {
          result.successful.push({
            itemId: update.itemId,
            revision: response.revision,
          });
          result.successCount++;
          return { success: true, response, index: globalIndex };
        })
        .catch((error) => {
          const errorMessage = error instanceof Error ? error.message : String(error);
          result.failed.push({
            itemId: update.itemId,
            fields: update.fields,
            error: errorMessage,
            index: globalIndex,
          });
          result.failureCount++;

          logger.warn('Failed to update item in batch', {
            itemId: update.itemId,
            index: globalIndex,
            error: errorMessage,
          });

          return { success: false, error: errorMessage, index: globalIndex };
        });
    });

    const batchResults = await Promise.all(batchPromises);

    // Stop on first error if requested
    if (stopOnError && batchResults.some(r => !r.success)) {
      logger.warn('Stopping bulk update due to error', {
        processed: i + batch.length,
        total: updates.length,
      });
      break;
    }

    logger.info('Bulk update batch complete', {
      processed: Math.min(i + concurrency, updates.length),
      total: updates.length,
      successCount: result.successCount,
      failureCount: result.failureCount,
    });
  }

  logger.info('Bulk update complete', {
    total: updates.length,
    successCount: result.successCount,
    failureCount: result.failureCount,
  });

  return result;
}

/**
 * Bulk delete result
 */
export interface BulkDeleteResult {
  successful: number[];
  failed: Array<{
    itemId: number;
    error: string;
    index: number;
  }>;
  successCount: number;
  failureCount: number;
}

/**
 * Bulk delete options
 */
export interface BulkDeleteOptions {
  /** Maximum concurrent requests (default: 5) */
  concurrency?: number;
  /** Whether to stop on first error (default: false) */
  stopOnError?: boolean;
  /** Retry configuration */
  retryConfig?: Parameters<typeof createRetryConfig>[0];
}

/**
 * Bulk delete items with controlled concurrency and retry logic
 */
export async function bulkDeleteItems(
  client: PodioHttpClient,
  itemIds: number[],
  options: BulkDeleteOptions = {}
): Promise<BulkDeleteResult> {
  const {
    concurrency = 5,
    stopOnError = false,
    retryConfig,
  } = options;

  logger.info('Starting bulk delete', {
    itemCount: itemIds.length,
    concurrency,
  });

  const result: BulkDeleteResult = {
    successful: [],
    failed: [],
    successCount: 0,
    failureCount: 0,
  };

  // Process in batches with concurrency control
  for (let i = 0; i < itemIds.length; i += concurrency) {
    const batch = itemIds.slice(i, i + concurrency);
    const batchPromises = batch.map((itemId, batchIndex) => {
      const globalIndex = i + batchIndex;

      return withRetry(
        () => deleteItem(client, itemId),
        createRetryConfig(retryConfig || { maxAttempts: 3 }),
        { method: 'DELETE', url: `/item/${itemId}` }
      )
        .then(() => {
          result.successful.push(itemId);
          result.successCount++;
          return { success: true, index: globalIndex };
        })
        .catch((error) => {
          const errorMessage = error instanceof Error ? error.message : String(error);
          result.failed.push({
            itemId,
            error: errorMessage,
            index: globalIndex,
          });
          result.failureCount++;

          logger.warn('Failed to delete item in batch', {
            itemId,
            index: globalIndex,
            error: errorMessage,
          });

          return { success: false, error: errorMessage, index: globalIndex };
        });
    });

    const batchResults = await Promise.all(batchPromises);

    // Stop on first error if requested
    if (stopOnError && batchResults.some(r => !r.success)) {
      logger.warn('Stopping bulk delete due to error', {
        processed: i + batch.length,
        total: itemIds.length,
      });
      break;
    }

    logger.info('Bulk delete batch complete', {
      processed: Math.min(i + concurrency, itemIds.length),
      total: itemIds.length,
      successCount: result.successCount,
      failureCount: result.failureCount,
    });
  }

  logger.info('Bulk delete complete', {
    total: itemIds.length,
    successCount: result.successCount,
    failureCount: result.failureCount,
  });

  return result;
}

// ============================================================================
// Item Matching & Duplicate Detection
// ============================================================================

/**
 * Find an item by field value
 * Searches for an item in an app where a specific field matches a value
 * Supports pre-normalized values for duplicate checking
 */
export async function findItemByFieldValue(
  client: PodioHttpClient,
  appId: number,
  fieldExternalId: string,
  value: unknown,
  options?: {
    /** Use pre-normalized value (skip client-side normalization) */
    isNormalized?: boolean;
  }
): Promise<PodioItem | null> {
  logger.info('Finding item by field value', {
    appId,
    fieldExternalId,
    value,
    valueType: typeof value,
    isNormalized: options?.isNormalized,
  });

  try {
    // Build filter based on field value
    const filters: Record<string, unknown> = {};

    // Handle different value types for Podio filter API
    if (value === null || value === undefined) {
      logger.debug('Skipping search for null/undefined value', {
        appId,
        fieldExternalId,
      });
      return null;
    }

    // For text, number, and most field types, use direct value
    filters[fieldExternalId] = value;

    logger.debug('Sending Podio filter request', {
      appId,
      fieldExternalId,
      filters,
      rawValue: value,
    });

    const response = await withRetry(
      () => filterItems(client, appId, {
        filters,
        limit: 1, // We only need the first match
        offset: 0,
      }),
      createRetryConfig({ maxAttempts: 3 }),
      { method: 'POST', url: `/item/app/${appId}/filter/` }
    );

    logger.debug('Podio filter response received', {
      appId,
      fieldExternalId,
      itemsReturned: response.items.length,
      filtered: response.filtered,
      total: response.total,
    });

    if (response.items.length > 0) {
      const foundItem = response.items[0];
      logger.info('Found item by field value', {
        appId,
        fieldExternalId,
        itemId: foundItem.item_id,
        multipleMatches: response.filtered > 1,
      });
      return foundItem;
    }

    logger.debug('No item found with field value', {
      appId,
      fieldExternalId,
      value,
      valueType: typeof value,
    });
    return null;
  } catch (error) {
    logger.error('Failed to find item by field value', {
      appId,
      fieldExternalId,
      value,
      valueType: typeof value,
      error,
    });
    // Return null instead of throwing to allow migration to continue
    return null;
  }
}

/**
 * Find multiple items by field values
 * Batch lookup for multiple values
 */
export async function findItemsByFieldValues(
  client: PodioHttpClient,
  appId: number,
  fieldExternalId: string,
  values: unknown[]
): Promise<Map<unknown, PodioItem>> {
  logger.info('Finding items by field values (batch)', {
    appId,
    fieldExternalId,
    valueCount: values.length,
  });

  const resultMap = new Map<unknown, PodioItem>();

  // Process in smaller batches to avoid overwhelming the API
  const batchSize = 50;
  for (let i = 0; i < values.length; i += batchSize) {
    const batch = values.slice(i, i + batchSize);

    // Search for each value
    const promises = batch.map(async (value) => {
      const item = await findItemByFieldValue(client, appId, fieldExternalId, value);
      if (item) {
        resultMap.set(value, item);
      }
    });

    await Promise.all(promises);
  }

  logger.info('Batch find complete', {
    appId,
    fieldExternalId,
    totalSearched: values.length,
    found: resultMap.size,
  });

  return resultMap;
}
