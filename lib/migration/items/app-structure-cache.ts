/**
 * App Structure Cache for caching Podio app field definitions
 * Separate from PrefetchCache to allow independent TTL and management
 *
 * Benefits:
 * - Reduces API calls for app structure fetching
 * - Detects stale cache when fields are deleted
 * - Configurable TTL (default: 30 minutes)
 * - App-specific cache invalidation
 */

import { getApplication } from '../../podio/resources/applications';
import { Application } from '../../podio/types';
import { getPodioHttpClient } from '../../podio/http/client';
import { logger as migrationLogger } from '../logging';

/**
 * Cache entry with metadata for TTL tracking
 */
interface CacheEntry<T> {
  value: T;
  createdAt: Date;
  lastAccessedAt: Date;
  revision?: number; // App revision for staleness detection
}

/**
 * Cache configuration
 */
export interface AppCacheConfig {
  ttlMs: number; // Time to live in milliseconds (default: 30 minutes)
}

/**
 * App structure cache statistics
 */
export interface AppStructureCacheStats {
  apps: number[]; // List of cached app IDs
  totalApps: number;
  totalFields: number;
  ageMs: number; // Age of oldest entry
  hits: number;
  misses: number;
  hitRate: number;
}

/**
 * App Structure Cache
 *
 * Usage:
 * ```typescript
 * const cache = getAppStructureCache();
 * const app = await cache.getAppStructure(12345);
 * ```
 */
export class AppStructureCache {
  private cache: Map<number, CacheEntry<Application>> = new Map();
  private config: AppCacheConfig;
  private hits: number = 0;
  private misses: number = 0;

  constructor(config?: Partial<AppCacheConfig>) {
    this.config = {
      ttlMs: config?.ttlMs ?? 1800000, // Default: 30 minutes
    };
  }

  /**
   * Check if a cache entry is expired based on TTL
   *
   * @param entry - Cache entry to check
   * @returns True if entry is expired, false otherwise
   */
  private isExpired(entry: CacheEntry<Application>): boolean {
    const ageMs = Date.now() - entry.createdAt.getTime();
    return ageMs > this.config.ttlMs;
  }

  /**
   * Get app structure from cache or fetch from API
   *
   * @param appId - App ID to fetch
   * @returns Application structure with fields
   */
  async getAppStructure(appId: number): Promise<Application> {
    const entry = this.cache.get(appId);

    // Check if cached and not expired
    if (entry && !this.isExpired(entry)) {
      this.hits++;
      entry.lastAccessedAt = new Date();
      migrationLogger.debug('App structure cache hit', {
        appId,
        fieldsCount: entry.value.fields?.length || 0,
        ageMs: Date.now() - entry.createdAt.getTime(),
      });
      return entry.value;
    }

    // Cache miss or expired - fetch from API
    this.misses++;
    migrationLogger.debug('App structure cache miss - fetching from API', {
      appId,
      reason: entry ? 'expired' : 'not cached',
    });

    const client = getPodioHttpClient();
    const app = await getApplication(appId);

    // Store in cache
    const now = new Date();
    this.cache.set(appId, {
      value: app,
      createdAt: now,
      lastAccessedAt: now,
      revision: (app as any).revision, // Revision tracking (if available)
    });

    migrationLogger.info('App structure cached', {
      appId,
      fieldsCount: app.fields?.length || 0,
      revision: (app as any).revision,
    });

    return app;
  }

  /**
   * Force refresh app structure from API
   *
   * @param appId - App ID to refresh
   * @returns Updated application structure
   */
  async refreshAppStructure(appId: number): Promise<Application> {
    migrationLogger.info('Force refreshing app structure', { appId });

    // Remove from cache first
    this.cache.delete(appId);

    // Fetch fresh data
    return this.getAppStructure(appId);
  }

  /**
   * Clear cache for a specific app
   *
   * @param appId - App ID to clear cache for
   */
  clearAppStructure(appId: number): void {
    const deleted = this.cache.delete(appId);
    if (deleted) {
      migrationLogger.info('Cleared app structure cache', { appId });
    }
  }

  /**
   * Clear all cached app structures
   */
  clearAll(): void {
    const count = this.cache.size;
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
    migrationLogger.info('Cleared all app structure caches', {
      appsCleared: count,
    });
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): AppStructureCacheStats {
    const apps = Array.from(this.cache.keys());
    let totalFields = 0;
    let oldestAge = 0;
    const now = Date.now();

    for (const entry of this.cache.values()) {
      totalFields += entry.value.fields?.length || 0;
      const age = now - entry.createdAt.getTime();
      if (age > oldestAge) {
        oldestAge = age;
      }
    }

    const total = this.hits + this.misses;

    return {
      apps,
      totalApps: apps.length,
      totalFields,
      ageMs: oldestAge,
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? this.hits / total : 0,
    };
  }

  /**
   * Check if a specific app is cached and fresh
   *
   * @param appId - App ID to check
   * @returns True if cached and not expired
   */
  isCached(appId: number): boolean {
    const entry = this.cache.get(appId);
    return entry !== undefined && !this.isExpired(entry);
  }

  /**
   * Check if cache entry is stale based on app revision
   *
   * @param appId - App ID to check
   * @param currentRevision - Current app revision from API
   * @returns True if cached revision differs from current
   */
  isStale(appId: number, currentRevision: number): boolean {
    const entry = this.cache.get(appId);
    if (!entry || !entry.revision) {
      return false; // No cache or no revision tracking
    }
    return entry.revision !== currentRevision;
  }
}

/**
 * Singleton instance for app structure cache
 */
let appStructureCacheInstance: AppStructureCache | null = null;

/**
 * Get the singleton app structure cache instance
 */
export function getAppStructureCache(): AppStructureCache {
  if (!appStructureCacheInstance) {
    appStructureCacheInstance = new AppStructureCache();
  }
  return appStructureCacheInstance;
}

/**
 * Reset the singleton instance (useful for testing)
 */
export function resetAppStructureCache(): void {
  appStructureCacheInstance = null;
}
