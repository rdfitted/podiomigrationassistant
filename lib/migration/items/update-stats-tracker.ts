/**
 * Statistics tracker for UPDATE mode migrations
 * Tracks prefetch cache, match lookups, and update operations
 */

import { MigrationFileLogger } from '../file-logger';

/**
 * Prefetch statistics
 */
export interface PrefetchStats {
  /** Total items fetched from target app */
  totalFetched: number;
  /** Total items cached (with match values) */
  totalCached: number;
  /** Total items skipped (without match values) */
  totalSkipped: number;
  /** Unique cache keys */
  uniqueKeys: number;
  /** Duration in milliseconds */
  durationMs: number;
  /** Items per second */
  itemsPerSecond: number;
}

/**
 * Match lookup statistics
 */
export interface MatchStats {
  /** Total lookup attempts */
  totalLookups: number;
  /** Cache hits (item found) */
  hits: number;
  /** Cache misses (item not found) */
  misses: number;
  /** Hit rate (0-1) */
  hitRate: number;
}

/**
 * Update operation statistics
 */
export interface UpdateStats {
  /** Total update attempts */
  totalAttempts: number;
  /** Successful updates */
  successful: number;
  /** Failed updates */
  failed: number;
  /** Success rate (0-1) */
  successRate: number;
}

/**
 * Overall UPDATE mode statistics
 */
export interface UpdateModeStats {
  prefetch: PrefetchStats | null;
  matches: MatchStats;
  updates: UpdateStats;
  /** Overall progress (0-100) */
  progressPercent: number;
  /** Estimated time to completion (ms) */
  estimatedTimeRemaining: number | null;
}

/**
 * Statistics tracker for UPDATE mode migrations
 */
export class UpdateStatsTracker {
  private migrationId: string;
  private logger: MigrationFileLogger | null = null;

  // Prefetch stats
  private prefetchStats: PrefetchStats | null = null;

  // Match stats
  private matchLookups: number = 0;
  private matchHits: number = 0;
  private matchMisses: number = 0;

  // Update stats
  private updateAttempts: number = 0;
  private updateSuccesses: number = 0;
  private updateFailures: number = 0;

  // Progress tracking
  private totalItems: number = 0;
  private processedItems: number = 0;
  private startTime: number = Date.now();

  // Logging interval
  private lastLogTime: number = 0;
  private readonly LOG_INTERVAL_MS = 5000; // Log every 5 seconds

  constructor(migrationId: string, logger?: MigrationFileLogger) {
    this.migrationId = migrationId;
    this.logger = logger || null;
  }

  /**
   * Set the logger for this tracker
   */
  setLogger(logger: MigrationFileLogger): void {
    this.logger = logger;
  }

  /**
   * Record prefetch completion
   */
  recordPrefetchComplete(stats: PrefetchStats): void {
    this.prefetchStats = stats;

    // Log to stats.log
    if (this.logger) {
      this.logger.logStats('prefetch_complete', {
        migrationId: this.migrationId,
        totalFetched: stats.totalFetched,
        totalCached: stats.totalCached,
        totalSkipped: stats.totalSkipped,
        uniqueKeys: stats.uniqueKeys,
        durationMs: stats.durationMs,
        itemsPerSecond: stats.itemsPerSecond,
      });
    }
  }

  /**
   * Record a match lookup attempt
   */
  recordMatchLookup(hit: boolean): void {
    this.matchLookups++;
    if (hit) {
      this.matchHits++;
    } else {
      this.matchMisses++;
    }

    // Periodically log match statistics
    this.maybeLogStats();
  }

  /**
   * Record an update attempt
   */
  recordUpdateAttempt(success: boolean): void {
    this.updateAttempts++;
    if (success) {
      this.updateSuccesses++;
    } else {
      this.updateFailures++;
    }
    this.processedItems++;

    // Periodically log update statistics
    this.maybeLogStats();
  }

  /**
   * Set total items count
   *
   * IMPORTANT: This method should be called before recording any update attempts
   * to ensure accurate progress calculations (percent complete, ETA). If called
   * after recording has started, progress metrics may be incorrect until enough
   * items have been processed to stabilize the calculations.
   *
   * @param total - Total number of items to be processed in this migration
   */
  setTotalItems(total: number): void {
    this.totalItems = total;
  }

  /**
   * Get current statistics
   */
  getStats(): UpdateModeStats {
    const matchHitRate = this.matchLookups > 0 ? this.matchHits / this.matchLookups : 0;
    const updateSuccessRate = this.updateAttempts > 0 ? this.updateSuccesses / this.updateAttempts : 0;
    const progressPercent = this.totalItems > 0 ? Math.round((this.processedItems / this.totalItems) * 100) : 0;

    // Estimate time remaining based on current throughput
    let estimatedTimeRemaining: number | null = null;
    if (this.processedItems > 0 && this.totalItems > 0) {
      const elapsedMs = Date.now() - this.startTime;
      const avgTimePerItem = elapsedMs / this.processedItems;
      const remainingItems = this.totalItems - this.processedItems;
      estimatedTimeRemaining = Math.round(avgTimePerItem * remainingItems);
    }

    return {
      prefetch: this.prefetchStats,
      matches: {
        totalLookups: this.matchLookups,
        hits: this.matchHits,
        misses: this.matchMisses,
        hitRate: matchHitRate,
      },
      updates: {
        totalAttempts: this.updateAttempts,
        successful: this.updateSuccesses,
        failed: this.updateFailures,
        successRate: updateSuccessRate,
      },
      progressPercent,
      estimatedTimeRemaining,
    };
  }

  /**
   * Log statistics if enough time has passed
   */
  private maybeLogStats(): void {
    const now = Date.now();
    if (now - this.lastLogTime < this.LOG_INTERVAL_MS) {
      return; // Too soon
    }

    this.lastLogTime = now;
    this.logStats();
  }

  /**
   * Force log current statistics
   */
  logStats(): void {
    if (!this.logger) return;

    const stats = this.getStats();

    this.logger.logStats('update_mode_progress', {
      migrationId: this.migrationId,
      prefetch: stats.prefetch,
      matches: {
        totalLookups: stats.matches.totalLookups,
        hits: stats.matches.hits,
        misses: stats.matches.misses,
        hitRate: Math.round(stats.matches.hitRate * 100),
      },
      updates: {
        totalAttempts: stats.updates.totalAttempts,
        successful: stats.updates.successful,
        failed: stats.updates.failed,
        successRate: Math.round(stats.updates.successRate * 100),
      },
      progress: {
        total: this.totalItems,
        processed: this.processedItems,
        percent: stats.progressPercent,
        estimatedTimeRemainingMs: stats.estimatedTimeRemaining,
      },
    });
  }

  /**
   * Log final statistics
   */
  logFinalStats(): void {
    if (!this.logger) return;

    const stats = this.getStats();
    const totalDurationMs = Date.now() - this.startTime;

    this.logger.logStats('update_mode_complete', {
      migrationId: this.migrationId,
      prefetch: stats.prefetch,
      matches: {
        totalLookups: stats.matches.totalLookups,
        hits: stats.matches.hits,
        misses: stats.matches.misses,
        hitRate: Math.round(stats.matches.hitRate * 100),
      },
      updates: {
        totalAttempts: stats.updates.totalAttempts,
        successful: stats.updates.successful,
        failed: stats.updates.failed,
        successRate: Math.round(stats.updates.successRate * 100),
      },
      totalDurationMs,
      throughput: {
        itemsPerSecond: this.processedItems > 0 ? Math.round(this.processedItems / (totalDurationMs / 1000)) : 0,
      },
    });
  }
}
