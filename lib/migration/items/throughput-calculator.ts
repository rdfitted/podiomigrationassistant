/**
 * Throughput Calculator for Migration Performance Metrics
 *
 * Tracks batch timing, calculates rolling averages, and provides ETA estimates
 * for accurate real-time progress tracking during large migrations.
 */

import { ThroughputMetrics } from '../state-store';

interface BatchTiming {
  batchNumber: number;
  startTime: number;
  endTime: number;
  itemsProcessed: number;
  wasRateLimited: boolean;
  rateLimitDelay: number; // milliseconds
}

export class ThroughputCalculator {
  private batchTimings: BatchTiming[] = [];
  private readonly ROLLING_WINDOW_SIZE = 10; // Last 10 batches for rolling average
  private totalRateLimitPauses = 0;
  private totalRateLimitDelay = 0; // milliseconds
  private migrationStartTime: number;

  constructor() {
    this.migrationStartTime = Date.now();
  }

  /**
   * Record the start of a batch
   */
  startBatch(batchNumber: number): number {
    return Date.now();
  }

  /**
   * Record the completion of a batch
   */
  completeBatch(
    batchNumber: number,
    batchStartTime: number,
    itemsProcessed: number,
    wasRateLimited: boolean = false,
    rateLimitDelay: number = 0
  ): void {
    const endTime = Date.now();

    this.batchTimings.push({
      batchNumber,
      startTime: batchStartTime,
      endTime,
      itemsProcessed,
      wasRateLimited,
      rateLimitDelay,
    });

    // Track rate limit stats
    if (wasRateLimited) {
      this.totalRateLimitPauses++;
      this.totalRateLimitDelay += rateLimitDelay;
    }

    // Keep only last N batches for rolling average
    if (this.batchTimings.length > this.ROLLING_WINDOW_SIZE) {
      this.batchTimings.shift();
    }
  }

  /**
   * Calculate current throughput metrics
   */
  calculateMetrics(
    totalItems: number,
    processedItems: number
  ): ThroughputMetrics {
    const now = Date.now();
    const totalDuration = now - this.migrationStartTime; // milliseconds

    // Calculate overall metrics
    const totalSeconds = totalDuration / 1000;
    const overallItemsPerSecond = processedItems / totalSeconds;

    // Calculate rolling average metrics from recent batches
    let rollingItemsPerSecond = overallItemsPerSecond;
    let rollingBatchesPerMinute = 0;
    let avgBatchDuration = 0;

    if (this.batchTimings.length > 0) {
      // Sum items and duration from rolling window
      const recentBatches = this.batchTimings.slice(-this.ROLLING_WINDOW_SIZE);
      const totalRecentItems = recentBatches.reduce((sum, b) => sum + b.itemsProcessed, 0);
      const totalRecentDuration = recentBatches.reduce(
        (sum, b) => sum + (b.endTime - b.startTime),
        0
      );

      // Calculate rolling average throughput
      const recentSeconds = totalRecentDuration / 1000;
      rollingItemsPerSecond = totalRecentItems / recentSeconds;

      // Calculate batches per minute
      const recentMinutes = recentSeconds / 60;
      rollingBatchesPerMinute = recentBatches.length / recentMinutes;

      // Average batch duration
      avgBatchDuration = totalRecentDuration / recentBatches.length;
    }

    // Calculate ETA
    const remainingItems = totalItems - processedItems;
    let estimatedCompletionTime: Date | undefined;

    if (remainingItems > 0 && rollingItemsPerSecond > 0) {
      const estimatedRemainingSeconds = remainingItems / rollingItemsPerSecond;

      // Add buffer for rate limiting (assume 10% overhead based on historical data)
      const rateLimitBuffer = this.totalRateLimitPauses > 0 ? 1.1 : 1.0;
      const bufferedSeconds = estimatedRemainingSeconds * rateLimitBuffer;

      estimatedCompletionTime = new Date(now + bufferedSeconds * 1000);
    }

    return {
      itemsPerSecond: parseFloat(rollingItemsPerSecond.toFixed(2)),
      batchesPerMinute: parseFloat(rollingBatchesPerMinute.toFixed(2)),
      avgBatchDuration: parseFloat(avgBatchDuration.toFixed(0)),
      estimatedCompletionTime,
      rateLimitPauses: this.totalRateLimitPauses,
      totalRateLimitDelay: this.totalRateLimitDelay,
    };
  }

  /**
   * Get summary statistics for logging
   */
  getSummaryStats(): {
    totalBatchesProcessed: number;
    avgBatchDuration: number;
    totalRateLimitPauses: number;
    totalRateLimitDelay: number;
    overallDuration: number;
  } {
    const totalDuration = Date.now() - this.migrationStartTime;
    const avgDuration = this.batchTimings.length > 0
      ? this.batchTimings.reduce((sum, b) => sum + (b.endTime - b.startTime), 0) / this.batchTimings.length
      : 0;

    return {
      totalBatchesProcessed: this.batchTimings.length,
      avgBatchDuration: parseFloat(avgDuration.toFixed(0)),
      totalRateLimitPauses: this.totalRateLimitPauses,
      totalRateLimitDelay: this.totalRateLimitDelay,
      overallDuration: totalDuration,
    };
  }

  /**
   * Record a rate limit pause
   */
  recordRateLimitPause(delayMs: number): void {
    this.totalRateLimitPauses++;
    this.totalRateLimitDelay += delayMs;
  }

  /**
   * Reset calculator (for testing or migration restart)
   */
  reset(): void {
    this.batchTimings = [];
    this.totalRateLimitPauses = 0;
    this.totalRateLimitDelay = 0;
    this.migrationStartTime = Date.now();
  }
}
