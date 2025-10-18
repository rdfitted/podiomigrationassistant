/**
 * Duplicate detection utilities for item migration
 * Provides normalization and caching for efficient duplicate checking
 */

import { PodioItem, PodioItemField } from '../../podio/resources/items';
import { logger as migrationLogger } from '../logging';

/**
 * Normalized match value
 */
export interface NormalizedValue {
  /** Original value */
  original: unknown;
  /** Normalized value for comparison */
  normalized: string;
  /** Field type */
  fieldType: string;
}

/**
 * Duplicate check result
 */
export interface DuplicateCheckResult {
  /** Whether a duplicate was found */
  isDuplicate: boolean;
  /** Existing item if duplicate found */
  existingItem?: PodioItem;
  /** Normalized match key used for lookup */
  normalizedKey: string;
  /** Whether result was from cache */
  fromCache: boolean;
}

/**
 * Normalize a field value for duplicate matching
 * Handles whitespace, casing, and type-specific formatting
 */
export function normalizeMatchValue(value: unknown, fieldType: string): string {
  if (value === null || value === undefined) {
    return '';
  }

  switch (fieldType) {
    case 'text':
      // Trim whitespace, convert to lowercase for case-insensitive matching
      return String(value).trim().toLowerCase();

    case 'number':
      // Coerce to number string, handle both string and number inputs
      const num = typeof value === 'number' ? value : parseFloat(String(value));
      return isNaN(num) ? '' : String(num);

    case 'category':
      // Multi-value: sort IDs for consistent comparison
      if (Array.isArray(value)) {
        return value
          .map(v => String(v))
          .sort()
          .join(',');
      }
      return String(value);

    case 'app':
      // App reference: sort item IDs
      if (Array.isArray(value)) {
        return value
          .map(v => String(v))
          .sort()
          .join(',');
      }
      return String(value);

    case 'contact':
      // Contact: sort profile/user IDs
      if (Array.isArray(value)) {
        return value
          .map(v => String(v))
          .sort()
          .join(',');
      }
      return String(value);

    case 'email':
    case 'phone':
    case 'tel':
      // Email/phone: normalize to lowercase, remove whitespace
      if (Array.isArray(value)) {
        return value
          .map(v => {
            if (typeof v === 'object' && v !== null && 'value' in v) {
              return String((v as { value: unknown }).value).trim().toLowerCase();
            }
            return String(v).trim().toLowerCase();
          })
          .sort()
          .join(',');
      }
      return String(value).trim().toLowerCase();

    case 'date':
      // Date: use ISO format for consistency
      if (typeof value === 'object' && value !== null && 'start' in value) {
        const dateVal = value as { start?: string; end?: string };
        return dateVal.start || '';
      }
      return String(value);

    case 'money':
      // Money: normalize value, ignore currency for matching
      if (typeof value === 'object' && value !== null && 'value' in value) {
        const moneyVal = value as { value: number | string };
        return String(moneyVal.value);
      }
      return String(value);

    case 'duration':
    case 'location':
    case 'question':
    default:
      // Default: string comparison with trimming and lowercase
      return String(value).trim().toLowerCase();
  }
}

/**
 * Build a duplicate check key from normalized value
 * Includes field info for cache keying
 */
export function buildDuplicateKey(
  appId: number,
  fieldExternalId: string,
  normalizedValue: string
): string {
  return `${appId}:${fieldExternalId}:${normalizedValue}`;
}

/**
 * Duplicate checker with caching
 */
export class DuplicateChecker {
  private cache: Map<string, PodioItem | null> = new Map();
  private cacheHits = 0;
  private cacheMisses = 0;

  /**
   * Check if an item is a duplicate
   * Uses cache to avoid redundant Podio API calls
   */
  async checkDuplicate(
    lookupFn: (normalizedValue: string) => Promise<PodioItem | null>,
    appId: number,
    fieldExternalId: string,
    value: unknown,
    fieldType: string
  ): Promise<DuplicateCheckResult> {
    // Normalize the value
    const normalizedValue = normalizeMatchValue(value, fieldType);
    const cacheKey = buildDuplicateKey(appId, fieldExternalId, normalizedValue);

    migrationLogger.debug('Duplicate checker - checking cache', {
      appId,
      fieldExternalId,
      originalValue: value,
      normalizedValue,
      cacheKey,
    });

    // Check cache first
    if (this.cache.has(cacheKey)) {
      this.cacheHits++;
      const cachedItem = this.cache.get(cacheKey) || undefined;

      migrationLogger.debug('Duplicate checker - cache hit', {
        cacheKey,
        foundInCache: !!cachedItem,
        cacheHits: this.cacheHits,
        cacheMisses: this.cacheMisses,
      });

      return {
        isDuplicate: !!cachedItem,
        existingItem: cachedItem,
        normalizedKey: normalizedValue,
        fromCache: true,
      };
    }

    // Cache miss - perform lookup
    this.cacheMisses++;

    migrationLogger.debug('Duplicate checker - cache miss, performing lookup', {
      cacheKey,
      normalizedValue,
      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses,
    });

    const existingItem = await lookupFn(normalizedValue);

    // Store in cache (including null results to prevent repeated lookups)
    this.cache.set(cacheKey, existingItem);

    migrationLogger.debug('Duplicate checker - lookup complete', {
      cacheKey,
      found: !!existingItem,
      existingItemId: existingItem?.item_id,
    });

    return {
      isDuplicate: !!existingItem,
      existingItem: existingItem || undefined,
      normalizedKey: normalizedValue,
      fromCache: false,
    };
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { hits: number; misses: number; size: number; hitRate: number } {
    const total = this.cacheHits + this.cacheMisses;
    const hitRate = total > 0 ? this.cacheHits / total : 0;

    return {
      hits: this.cacheHits,
      misses: this.cacheMisses,
      size: this.cache.size,
      hitRate: Math.round(hitRate * 100) / 100,
    };
  }

  /**
   * Clear cache (useful for fresh migration runs)
   */
  clearCache(): void {
    migrationLogger.info('Duplicate checker - clearing cache', this.getCacheStats());
    this.cache.clear();
    this.cacheHits = 0;
    this.cacheMisses = 0;
  }

  /**
   * Log cache statistics
   */
  logCacheStats(): void {
    const stats = this.getCacheStats();
    migrationLogger.info('Duplicate checker - cache statistics', stats);
  }
}
