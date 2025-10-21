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

/**
 * Normalize a value for consistent matching
 * Handles strings, numbers, arrays, and objects
 *
 * Returns empty string for "empty" values: null, undefined, "", 0, false
 * Caller should skip empty values (don't match empty to empty)
 */
function normalizeValue(value: unknown): string {
  // UPDATED: Treat 0, false, "", null, undefined as empty
  if (
    value === null ||
    value === undefined ||
    value === '' ||
    value === 0 ||
    value === false
  ) {
    return '';
  }

  // Handle arrays (multi-value fields)
  if (Array.isArray(value)) {
    // Sort array elements for consistent comparison
    const normalized = value
      .map(v => normalizeValue(v))
      .filter(v => v !== '') // Filter out empty values
      .sort()
      .join('||');

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

  // UPDATED: Handle numbers - parse and convert to whole number
  if (typeof value === 'number') {
    // Round to whole number
    const wholeNumber = Math.round(value);
    return String(wholeNumber);
  }

  // Handle string numbers - parse and normalize
  if (typeof value === 'string') {
    const trimmed = value.trim();

    // Try to parse as number
    const parsed = parseFloat(trimmed);
    if (!isNaN(parsed)) {
      // It's a numeric string - normalize as whole number
      const wholeNumber = Math.round(parsed);
      return String(wholeNumber);
    }

    // Not a number - normalize as text (lowercase, trim edges only)
    return trimmed.toLowerCase();
  }

  // Handle primitives (boolean already handled above)
  return String(value).trim().toLowerCase();
}

/**
 * Cache entry with metadata for TTL tracking
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
  ttlMs: number; // Time to live in milliseconds (default: 30 minutes)
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
  private cache: Map<string, CacheEntry<PodioItem>> = new Map();
  private matchField: string = '';
  private hits: number = 0;
  private misses: number = 0;
  private config: CacheConfig;
  private appId?: number;

  constructor(config?: Partial<CacheConfig>) {
    this.config = {
      ttlMs: config?.ttlMs ?? 1800000, // Default: 30 minutes
      maxSize: config?.maxSize,
    };
  }

  /**
   * Pre-fetch all items from target app and build cache
   *
   * @param client - Podio HTTP client
   * @param appId - Target app ID
   * @param matchField - Field external_id to use for matching (e.g., 'email', 'title')
   */
  async prefetchTargetItems(
    client: PodioHttpClient,
    appId: number,
    matchField: string
  ): Promise<void> {
    console.log('🔍 PRE-FETCH STARTING:', {
      appId,
      matchField,
      timestamp: new Date().toISOString(),
    });

    migrationLogger.info('Starting target item pre-fetch', {
      appId,
      matchField,
    });

    const startTime = Date.now();
    this.matchField = matchField;
    this.appId = appId;
    let itemCount = 0;

    try {
      // Stream all items from target app
      for await (const batch of streamItems(client, appId, {
        batchSize: 500,
      })) {
        for (const item of batch) {
          // Find the match field in the item
          const field = item.fields.find(f => f.external_id === matchField);

          // LOG: Debug each item's fields to see what we're getting
          migrationLogger.debug('Pre-fetch processing item', {
            appId,
            itemId: item.item_id,
            matchField,
            fieldFound: !!field,
            availableFields: item.fields.map(f => ({
              external_id: f.external_id,
              type: f.type,
              hasValues: f.values && f.values.length > 0,
            })),
          });

          if (field && field.values && field.values.length > 0) {
            // Extract and normalize the match value
            const matchValue = extractFieldValue(field);
            const normalizedKey = normalizeValue(matchValue);

            migrationLogger.debug('Pre-fetch found match value', {
              appId,
              itemId: item.item_id,
              matchField,
              matchValue,
              normalizedKey,
            });

            // UPDATED: Skip empty values when building cache
            if (normalizedKey && normalizedKey !== '') {
              // Store item in cache with metadata
              const now = new Date();
              this.cache.set(normalizedKey, {
                value: item,
                createdAt: now,
                lastAccessedAt: now,
                appId,
              });
            } else {
              migrationLogger.debug('Skipping item with empty match field value', {
                appId,
                itemId: item.item_id,
                matchField,
                matchValue,
                reason: 'Empty values are not cached (we don\'t match empties)',
              });
            }
          } else {
            migrationLogger.debug('Pre-fetch skipped item - field not found or empty', {
              appId,
              itemId: item.item_id,
              matchField,
              fieldFound: !!field,
              fieldHasValues: field?.values?.length || 0,
            });
          }

          itemCount++;
        }

        migrationLogger.info('Pre-fetch batch processed', {
          appId,
          matchField,
          batchSize: batch.length,
          totalCached: this.cache.size,
          totalItems: itemCount,
        });
      }

      const duration = Date.now() - startTime;

      console.log('✅ PRE-FETCH COMPLETE:', {
        appId,
        matchField,
        totalItems: itemCount,
        uniqueKeys: this.cache.size,
        durationMs: duration,
        itemsPerSecond: itemCount > 0 ? Math.round(itemCount / (duration / 1000)) : 0,
      });

      migrationLogger.info('Pre-fetch complete', {
        appId,
        matchField,
        totalItems: itemCount,
        uniqueKeys: this.cache.size,
        durationMs: duration,
        itemsPerSecond: itemCount > 0 ? Math.round(itemCount / (duration / 1000)) : 0,
      });
    } catch (error) {
      migrationLogger.error('Pre-fetch failed', {
        appId,
        matchField,
        itemCount,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Check if a cache entry is expired based on TTL
   *
   * @param entry - Cache entry to check
   * @returns True if entry is expired, false otherwise
   */
  private isExpired(entry: CacheEntry<PodioItem>): boolean {
    const ageMs = Date.now() - entry.createdAt.getTime();
    return ageMs > this.config.ttlMs;
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

    // UPDATED: Skip empty values - don't match empty to empty
    if (!normalizedKey || normalizedKey === '') {
      this.misses++;
      migrationLogger.debug('Skipping empty match value', {
        matchField: this.matchField,
        matchValue,
        reason: 'Empty values are not matched',
      });
      return false;
    }

    const entry = this.cache.get(normalizedKey);

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
      this.cache.delete(normalizedKey);
      this.misses++;
      migrationLogger.debug('Cache miss - entry expired', {
        matchField: this.matchField,
        matchValue,
        normalizedKey,
        ageMs: Date.now() - entry.createdAt.getTime(),
        ttlMs: this.config.ttlMs,
      });
      return false;
    }

    // Update last accessed time
    entry.lastAccessedAt = new Date();
    this.hits++;
    migrationLogger.debug('Cache hit', {
      matchField: this.matchField,
      matchValue,
      normalizedKey,
    });

    return true;
  }

  /**
   * Get the existing item with this match value (if any)
   * Returns null if match value is empty (we don't match empties to empties)
   *
   * @param matchValue - Value to search for (will be normalized)
   * @returns Existing PodioItem or null
   */
  getExistingItem(matchValue: unknown): PodioItem | null {
    const normalizedKey = normalizeValue(matchValue);

    // UPDATED: Skip empty values - don't match empty to empty
    if (!normalizedKey || normalizedKey === '') {
      this.misses++;
      migrationLogger.debug('Skipping empty match value', {
        matchField: this.matchField,
        matchValue,
        reason: 'Empty values are not matched',
      });
      return null;
    }

    const entry = this.cache.get(normalizedKey);

    if (!entry) {
      this.misses++;
      return null;
    }

    // Check TTL expiration
    if (this.isExpired(entry)) {
      this.cache.delete(normalizedKey);
      this.misses++;
      migrationLogger.debug('Cache miss - entry expired', {
        matchField: this.matchField,
        matchValue,
        normalizedKey,
        ageMs: Date.now() - entry.createdAt.getTime(),
        ttlMs: this.config.ttlMs,
      });
      return null;
    }

    // Update last accessed time
    entry.lastAccessedAt = new Date();
    this.hits++;
    migrationLogger.debug('Cache hit - item found', {
      matchField: this.matchField,
      matchValue,
      normalizedKey,
      itemId: entry.value.item_id,
    });

    return entry.value;
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
      const age = now - entry.createdAt.getTime();
      if (age > oldestEntryAge) {
        oldestEntryAge = age;
      }
    }

    return {
      totalItems: this.size(),
      uniqueKeys: this.cache.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? this.hits / total : 0,
      ageMs: oldestEntryAge,
      oldestEntryAge,
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
