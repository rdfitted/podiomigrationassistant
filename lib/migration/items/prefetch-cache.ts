/**
 * Pre-fetch cache for target app items
 * Eliminates duplicate API calls during migration by caching all target items upfront
 *
 * Benefits:
 * - Reduces API calls from 2+ per item to 1 per item
 * - O(1) duplicate lookups (in-memory)
 * - Handles normalized matching (case-insensitive, trimmed)
 * - Supports multi-value fields (arrays)
 */

import { PodioHttpClient } from '../../podio/http/client';
import { PodioItem, streamItems, extractFieldValue } from '../../podio/resources/items';
import { logger as migrationLogger } from '../logging';
import { MigrationFileLogger } from '../file-logger';
import { maskPII } from '../utils/pii-masking';
import { forceGC } from '../memory-monitor';

/**
 * Normalize a value for consistent matching
 * Handles strings, numbers, arrays, and objects
 *
 * Returns empty string for "empty" values: null, undefined, ""
 * Note: 0 and false are VALID values and will be matched
 * Caller should skip empty values (don't match empty to empty)
 */
function normalizeValue(value: unknown): string {
  // Only treat null, undefined, and empty string as empty
  // 0 and false are VALID values that should be matched
  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return '';
  }

  // Handle false explicitly (normalize to "false" string)
  if (value === false) {
    return 'false';
  }

  // Handle zero explicitly (normalize to "0" string)
  if (value === 0) {
    return '0';
  }

  // Handle arrays (multi-value fields)
  if (Array.isArray(value)) {
    // Sort array elements for consistent comparison
    const normalized = value
      .map(v => normalizeValue(v))
      .filter(v => v !== '') // Filter out empty values
      .sort()
      .join(',');

    // If all values were empty, return empty string
    return normalized || '';
  }

  // Handle objects (extract meaningful identifiers)
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;

    // Try common ID fields
    if ('item_id' in obj) return String(obj.item_id);
    if ('profile_id' in obj) return String(obj.profile_id);
    if ('user_id' in obj) return String(obj.user_id);

    // Handle nested value property (common in Podio fields)
    if ('value' in obj) return normalizeValue(obj.value);

    // Fallback to JSON representation
    return JSON.stringify(obj);
  }

  // Numbers: preserve numeric semantics without changing magnitude
  if (typeof value === 'number') {
    return String(value);
  }

  // Handle string numbers - parse and normalize without rounding
  if (typeof value === 'string') {
    const trimmed = value.trim();

    // Try to parse as number
    const parsed = parseFloat(trimmed);
    if (!isNaN(parsed)) {
      // Keep canonical numeric form (e.g., "678.90" -> "678.9")
      return String(parsed);
    }

    // Not a number - normalize as text (lowercase, trim edges only)
    return trimmed.toLowerCase();
  }

  // Handle primitives (boolean already handled above)
  return String(value).trim().toLowerCase();
}

/**
 * Exported wrapper for normalizeValue
 * Use this in tests and logs to access normalization logic
 *
 * @param value - Value to normalize
 * @returns Normalized string for matching
 */
export function normalizeForMatch(value: unknown): string {
  return normalizeValue(value);
}

/**
 * Slim cache entry - stores only essential data to minimize memory usage
 * Instead of storing the full PodioItem (with all fields, metadata, etc.),
 * we only store the item_id which is sufficient for duplicate detection.
 * This reduces memory consumption by ~90% for large datasets.
 */
interface SlimCacheEntry {
  /** Target item ID (for duplicate detection) */
  itemId: number;
  /** Original match value (for debugging/logging) */
  matchValue: unknown;
  /** Creation timestamp (for TTL tracking) */
  createdAt: number; // Use number (timestamp) instead of Date to save memory
  /** App ID (for multi-app cache support) */
  appId?: number;
}

/**
 * Legacy cache entry with metadata for TTL tracking
 * @deprecated Use SlimCacheEntry instead for better memory efficiency
 */
interface CacheEntry<T> {
  value: T;
  createdAt: Date;
  lastAccessedAt: Date;
  appId?: number;
}

/**
 * Cache configuration
 */
export interface CacheConfig {
  ttlMs: number; // Time to live in milliseconds (default: 12 hours for long migrations)
  maxSize?: number; // Optional max cache size
}

/**
 * Cache statistics
 */
export interface CacheStats {
  totalItems: number;
  uniqueKeys: number;
  hits: number;
  misses: number;
  hitRate: number;
  ageMs: number; // Age of oldest entry in cache
  oldestEntryAge: number; // Age of oldest entry
  estimatedMemoryBytes?: number; // Estimated memory usage in bytes
  estimatedMemoryMB?: number; // Estimated memory usage in MB
}

/**
 * Pre-fetch cache for efficient duplicate detection
 *
 * Usage:
 * ```typescript
 * const cache = new PrefetchCache();
 * await cache.prefetchTargetItems(client, targetAppId, 'email');
 *
 * // Later, during migration (NO API call):
 * const existing = cache.getExistingItem('user@example.com');
 * if (existing) {
 *   // Item already exists
 * }
 * ```
 */
export class PrefetchCache {
  // Use slim cache entries to minimize memory usage
  private cache: Map<string, SlimCacheEntry> = new Map();
  private matchField: string = '';
  private hits: number = 0;
  private misses: number = 0;
  private config: CacheConfig;
  private appId?: number;

  constructor(config?: Partial<CacheConfig>) {
    this.config = {
      ttlMs: config?.ttlMs ?? 43200000, // Default: 12 hours (sufficient for very long migrations)
      maxSize: config?.maxSize,
    };
  }

  /**
   * Create a namespaced cache key to avoid collisions across apps/fields
   * @param normalizedKey - The normalized match value
   * @returns Namespaced key string
   */
  private makeKey(normalizedKey: string): string {
    return `${this.appId ?? 'na'}|${this.matchField}|${normalizedKey}`;
  }

  /**
   * Pre-fetch all items from target app and build cache
   *
   * @param client - Podio HTTP client
   * @param appId - Target app ID
   * @param matchField - Field external_id to use for matching (e.g., 'email', 'title')
   * @param logger - Optional file logger for detailed logging
   */
  async prefetchTargetItems(
    client: PodioHttpClient,
    appId: number,
    matchField: string,
    logger?: MigrationFileLogger
  ): Promise<void> {
    const startTime = Date.now();
    this.matchField = matchField;
    this.appId = appId;
    let itemCount = 0;
    let cachedCount = 0;
    let skippedCount = 0;
    let batchNum = 0;

    // Log to both migration logger and file logger
    migrationLogger.info('Starting target item pre-fetch', {
      appId,
      matchField,
      timestamp: new Date().toISOString(),
    });

    if (logger) {
      await logger.logPrefetch('INFO', 'prefetch_started', {
        targetAppId: appId,
        matchField,
        timestamp: new Date().toISOString(),
      });
    }

    try {
      // Stream all items from target app
      for await (const batch of streamItems(client, appId, {
        batchSize: 500,
      })) {
        batchNum++;
        let batchCached = 0;
        let batchSkipped = 0;

        for (const item of batch) {
          itemCount++;

          // Find the match field in the item
          const field = item.fields.find(f => f.external_id === matchField);

          if (field && field.values && field.values.length > 0) {
            // Extract and normalize the match value
            const matchValue = extractFieldValue(field);
            const normalizedKey = normalizeValue(matchValue);

            // Skip empty values when building cache
            if (normalizedKey && normalizedKey !== '') {
              // Store SLIM cache entry - only item_id and match value
              // This reduces memory usage by ~90% compared to storing full PodioItem
              this.cache.set(this.makeKey(normalizedKey), {
                itemId: item.item_id,
                matchValue,
                createdAt: Date.now(),
                appId,
              });
              cachedCount++;
              batchCached++;

              // Debug-level logging for each cached item (fire-and-forget for performance)
              if (logger) {
                void logger.logPrefetch('DEBUG', 'prefetch_item_cached', {
                  itemId: item.item_id,
                  matchValue: maskPII(matchValue),
                  normalizedKey: maskPII(normalizedKey),
                });
              }
            } else {
              skippedCount++;
              batchSkipped++;

              // Debug-level logging for skipped items (fire-and-forget for performance)
              if (logger) {
                void logger.logPrefetch('DEBUG', 'prefetch_item_skipped', {
                  itemId: item.item_id,
                  reason: 'no_match_field_value',
                  matchValue: maskPII(matchValue),
                });
              }
            }
          } else {
            skippedCount++;
            batchSkipped++;

            // Debug-level logging for items without match field (fire-and-forget for performance)
            if (logger) {
              void logger.logPrefetch('DEBUG', 'prefetch_item_skipped', {
                itemId: item.item_id,
                reason: 'match_field_not_found',
                matchField,
                availableFields: item.fields.map(f => f.external_id),
              });
            }
          }
        }

        // Log batch progress
        migrationLogger.info('Pre-fetch batch processed', {
          appId,
          matchField,
          batchNum,
          batchSize: batch.length,
          batchCached,
          batchSkipped,
          totalCached: cachedCount,
          totalSkipped: skippedCount,
          totalItems: itemCount,
        });

        if (logger) {
          await logger.logPrefetch('INFO', 'prefetch_batch_processed', {
            batchNum,
            batchSize: batch.length,
            itemsCached: batchCached,
            itemsSkipped: batchSkipped,
            totalCached: cachedCount,
            totalSkipped: skippedCount,
            totalItems: itemCount,
          });
        }
      }

      const duration = Date.now() - startTime;

      // Calculate estimated memory usage
      const estimatedMemoryBytes = this.estimateMemoryUsage();
      const estimatedMemoryMB = Math.round((estimatedMemoryBytes / (1024 * 1024)) * 100) / 100;

      migrationLogger.info('Pre-fetch complete', {
        appId,
        matchField,
        totalFetched: itemCount,
        totalCached: cachedCount,
        totalSkipped: skippedCount,
        uniqueKeys: this.cache.size,
        durationMs: duration,
        itemsPerSecond: itemCount > 0 ? Math.round(itemCount / (duration / 1000)) : 0,
        estimatedMemoryMB,
      });

      if (logger) {
        await logger.logPrefetch('INFO', 'prefetch_complete', {
          targetAppId: appId,
          matchField,
          totalFetched: itemCount,
          totalCached: cachedCount,
          totalSkipped: skippedCount,
          uniqueKeys: this.cache.size,
          durationMs: duration,
          itemsPerSecond: itemCount > 0 ? Math.round(itemCount / (duration / 1000)) : 0,
          estimatedMemoryMB,
        });
      }

      // Suggest garbage collection after large prefetch
      if (estimatedMemoryMB > 100) {
        migrationLogger.info('Running garbage collection after large prefetch', {
          estimatedMemoryMB: Math.round(estimatedMemoryMB),
        });
        forceGC();
      }
    } catch (error) {
      migrationLogger.error('Pre-fetch failed', {
        appId,
        matchField,
        itemCount,
        error: error instanceof Error ? error.message : String(error),
      });

      if (logger) {
        await logger.logPrefetch('ERROR', 'prefetch_failed', {
          targetAppId: appId,
          matchField,
          totalFetched: itemCount,
          totalCached: cachedCount,
          totalSkipped: skippedCount,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      throw error;
    }
  }

  /**
   * Check if a cache entry is expired based on TTL
   *
   * @param entry - Cache entry to check
   * @returns True if entry is expired, false otherwise
   */
  private isExpired(entry: SlimCacheEntry): boolean {
    const ageMs = Date.now() - entry.createdAt;
    return ageMs > this.config.ttlMs;
  }

  /**
   * Estimate memory usage of the cache
   * This is a rough estimate based on:
   * - Map overhead: ~100 bytes per entry
   * - Key string: ~50 bytes average
   * - SlimCacheEntry: ~100 bytes (itemId + matchValue + timestamps)
   *
   * @returns Estimated memory usage in bytes
   */
  private estimateMemoryUsage(): number {
    const BYTES_PER_ENTRY = 250; // Conservative estimate
    return this.cache.size * BYTES_PER_ENTRY;
  }

  /**
   * Check if an item with this match value exists in target app
   * Returns false if match value is empty (we don't match empties to empties)
   *
   * @param matchValue - Value to search for (will be normalized)
   * @returns True if item exists, false otherwise
   */
  isDuplicate(matchValue: unknown): boolean {
    const normalizedKey = normalizeValue(matchValue);

    // Skip empty values - don't match empty to empty
    if (!normalizedKey || normalizedKey === '') {
      this.misses++;
      migrationLogger.debug('Skipping empty match value', {
        matchField: this.matchField,
        matchValue,
        reason: 'Empty values (null, undefined, "") are not matched',
      });
      return false;
    }

    const entry = this.cache.get(this.makeKey(normalizedKey));

    if (!entry) {
      this.misses++;
      migrationLogger.debug('Cache miss - no entry', {
        matchField: this.matchField,
        matchValue,
        normalizedKey,
      });
      return false;
    }

    // Check TTL expiration
    if (this.isExpired(entry)) {
      this.cache.delete(this.makeKey(normalizedKey));
      this.misses++;
      migrationLogger.debug('Cache miss - entry expired', {
        matchField: this.matchField,
        matchValue,
        normalizedKey,
        ageMs: Date.now() - entry.createdAt,
        ttlMs: this.config.ttlMs,
      });
      return false;
    }

    // No need to update last accessed time in slim cache (saves memory)
    this.hits++;
    migrationLogger.debug('Cache hit', {
      matchField: this.matchField,
      matchValue,
      normalizedKey,
    });

    return true;
  }

  /**
   * Get the existing item ID with this match value (if any)
   * Returns null if match value is empty (we don't match empties to empties)
   *
   * Note: This now returns item_id instead of full PodioItem to save memory.
   * The item_id is sufficient for duplicate detection in UPDATE mode.
   *
   * @param matchValue - Value to search for (will be normalized)
   * @returns Existing item ID or null
   */
  getExistingItemId(matchValue: unknown): number | null {
    const normalizedKey = normalizeValue(matchValue);

    // Skip empty values - don't match empty to empty
    if (!normalizedKey || normalizedKey === '') {
      this.misses++;
      migrationLogger.debug('Skipping empty match value', {
        matchField: this.matchField,
        matchValue,
        reason: 'Empty values (null, undefined, "") are not matched',
      });
      return null;
    }

    const entry = this.cache.get(this.makeKey(normalizedKey));

    if (!entry) {
      this.misses++;
      return null;
    }

    // Check TTL expiration
    if (this.isExpired(entry)) {
      this.cache.delete(this.makeKey(normalizedKey));
      this.misses++;
      migrationLogger.debug('Cache miss - entry expired', {
        matchField: this.matchField,
        matchValue,
        normalizedKey,
        ageMs: Date.now() - entry.createdAt,
        ttlMs: this.config.ttlMs,
      });
      return null;
    }

    this.hits++;
    migrationLogger.debug('Cache hit - item found', {
      matchField: this.matchField,
      matchValue,
      normalizedKey,
      itemId: entry.itemId,
    });

    return entry.itemId;
  }

  /**
   * Legacy method for backward compatibility
   * @deprecated Use getExistingItemId() instead for better memory efficiency
   */
  getExistingItem(matchValue: unknown): PodioItem | null {
    // For backward compatibility, return null
    // Callers should migrate to getExistingItemId()
    const itemId = this.getExistingItemId(matchValue);
    if (itemId === null) {
      return null;
    }

    // We no longer store full PodioItems, so we can't return them
    // Return a minimal stub for backward compatibility
    return {
      item_id: itemId,
      fields: [],
    } as PodioItem;
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): CacheStats {
    const total = this.hits + this.misses;
    const now = Date.now();

    // Calculate age metrics
    let oldestEntryAge = 0;
    for (const entry of this.cache.values()) {
      const age = now - entry.createdAt;
      if (age > oldestEntryAge) {
        oldestEntryAge = age;
      }
    }

    const estimatedMemoryBytes = this.estimateMemoryUsage();
    const estimatedMemoryMB = Math.round((estimatedMemoryBytes / (1024 * 1024)) * 100) / 100;

    return {
      totalItems: this.size(),
      uniqueKeys: this.cache.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? this.hits / total : 0,
      ageMs: oldestEntryAge,
      oldestEntryAge,
      estimatedMemoryBytes,
      estimatedMemoryMB,
    };
  }

  /**
   * Get number of items in cache
   */
  size(): number {
    return this.cache.size;
  }

  /**
   * Log cache statistics
   */
  logCacheStats(): void {
    const stats = this.getCacheStats();
    migrationLogger.info('Pre-fetch cache statistics', {
      matchField: this.matchField,
      ...stats,
      hitRatePercent: Math.round(stats.hitRate * 100),
      estimatedMemoryMB: stats.estimatedMemoryMB,
    });
  }

  /**
   * Clear the cache
   */
  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
    migrationLogger.debug('Pre-fetch cache cleared');
  }

  /**
   * Clear cache for a specific app
   *
   * @param appId - App ID to clear cache for
   */
  clearAppCache(appId: number): void {
    let clearedCount = 0;
    for (const [key, entry] of this.cache.entries()) {
      if (entry.appId === appId) {
        this.cache.delete(key);
        clearedCount++;
      }
    }

    migrationLogger.info('Cleared app-specific cache', {
      appId,
      itemsCleared: clearedCount,
    });
  }

  /**
   * Check if cache is empty
   */
  isEmpty(): boolean {
    return this.cache.size === 0;
  }
}
