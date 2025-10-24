/**
 * Memory monitoring utilities for long-running migrations
 * Helps track memory usage and trigger garbage collection when needed
 */

import { logger as migrationLogger } from './logging';

/**
 * Memory usage statistics
 */
export interface MemoryStats {
  /** Total heap size in bytes */
  heapTotal: number;
  /** Used heap size in bytes */
  heapUsed: number;
  /** External memory usage in bytes */
  external: number;
  /** Resident set size in bytes */
  rss: number;
  /** Heap usage percentage (0-100) */
  heapUsedPercent: number;
  /** Heap size in MB */
  heapTotalMB: number;
  /** Used heap in MB */
  heapUsedMB: number;
  /** RSS in MB */
  rssMB: number;
}

/**
 * Memory monitor configuration
 */
export interface MemoryMonitorConfig {
  /** Threshold percentage for heap usage warning (default: 75) */
  warningThreshold: number;
  /** Threshold percentage for heap usage critical (default: 85) */
  criticalThreshold: number;
  /** Interval in milliseconds to check memory (default: 30000 = 30 seconds) */
  checkInterval: number;
  /** Whether to automatically trigger GC at critical threshold (default: true) */
  autoGC: boolean;
}

/**
 * Get current memory usage statistics
 */
export function getMemoryStats(): MemoryStats {
  const memUsage = process.memoryUsage();

  const heapUsedPercent = memUsage.heapTotal > 0
    ? (memUsage.heapUsed / memUsage.heapTotal) * 100
    : 0;

  return {
    heapTotal: memUsage.heapTotal,
    heapUsed: memUsage.heapUsed,
    external: memUsage.external,
    rss: memUsage.rss,
    heapUsedPercent,
    heapTotalMB: memUsage.heapTotal / (1024 * 1024),
    heapUsedMB: memUsage.heapUsed / (1024 * 1024),
    rssMB: memUsage.rss / (1024 * 1024),
  };
}

/**
 * Log memory statistics
 */
export function logMemoryStats(context?: string): void {
  const stats = getMemoryStats();

  migrationLogger.info('Memory usage', {
    context,
    heapUsedMB: Math.round(stats.heapUsedMB * 100) / 100,
    heapTotalMB: Math.round(stats.heapTotalMB * 100) / 100,
    heapUsedPercent: Math.round(stats.heapUsedPercent * 100) / 100,
    rssMB: Math.round(stats.rssMB * 100) / 100,
  });
}

/**
 * Force garbage collection if available
 * Requires Node.js to be started with --expose-gc flag
 */
export function forceGC(): boolean {
  if (global.gc) {
    const beforeStats = getMemoryStats();
    global.gc();
    const afterStats = getMemoryStats();

    const freedMB = beforeStats.heapUsedMB - afterStats.heapUsedMB;

    migrationLogger.info('Garbage collection completed', {
      beforeMB: Math.round(beforeStats.heapUsedMB * 100) / 100,
      afterMB: Math.round(afterStats.heapUsedMB * 100) / 100,
      freedMB: Math.round(freedMB * 100) / 100,
      heapUsedPercent: Math.round(afterStats.heapUsedPercent * 100) / 100,
    });

    return true;
  } else {
    migrationLogger.debug('GC not available - Node.js needs --expose-gc flag');
    return false;
  }
}

/**
 * Memory monitor class for continuous monitoring
 */
export class MemoryMonitor {
  private config: MemoryMonitorConfig;
  private intervalId: NodeJS.Timeout | null = null;
  private isMonitoring: boolean = false;
  private lastWarningTime: number = 0;
  private lastCriticalTime: number = 0;
  private readonly WARNING_COOLDOWN = 60000; // 1 minute between warnings
  private readonly CRITICAL_COOLDOWN = 30000; // 30 seconds between critical warnings

  constructor(config?: Partial<MemoryMonitorConfig>) {
    this.config = {
      warningThreshold: config?.warningThreshold ?? 75,
      criticalThreshold: config?.criticalThreshold ?? 85,
      checkInterval: config?.checkInterval ?? 30000, // 30 seconds
      autoGC: config?.autoGC ?? true,
    };
  }

  /**
   * Start monitoring memory usage
   */
  start(context?: string): void {
    if (this.isMonitoring) {
      migrationLogger.debug('Memory monitor already running');
      return;
    }

    this.isMonitoring = true;

    migrationLogger.info('Starting memory monitor', {
      context,
      warningThreshold: this.config.warningThreshold,
      criticalThreshold: this.config.criticalThreshold,
      checkIntervalMs: this.config.checkInterval,
      autoGC: this.config.autoGC,
    });

    // Check immediately
    this.checkMemory(context);

    // Then check at intervals
    this.intervalId = setInterval(() => {
      this.checkMemory(context);
    }, this.config.checkInterval);
  }

  /**
   * Stop monitoring memory usage
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    this.isMonitoring = false;
    migrationLogger.info('Memory monitor stopped');
  }

  /**
   * Check current memory usage and trigger warnings/GC if needed
   */
  private checkMemory(context?: string): void {
    const stats = getMemoryStats();
    const now = Date.now();

    // Always log at debug level
    migrationLogger.debug('Memory check', {
      context,
      heapUsedMB: Math.round(stats.heapUsedMB * 100) / 100,
      heapTotalMB: Math.round(stats.heapTotalMB * 100) / 100,
      heapUsedPercent: Math.round(stats.heapUsedPercent * 100) / 100,
    });

    // Check for critical threshold
    if (stats.heapUsedPercent >= this.config.criticalThreshold) {
      if (now - this.lastCriticalTime >= this.CRITICAL_COOLDOWN) {
        migrationLogger.warn('Memory usage critical - approaching limit', {
          context,
          heapUsedMB: Math.round(stats.heapUsedMB * 100) / 100,
          heapTotalMB: Math.round(stats.heapTotalMB * 100) / 100,
          heapUsedPercent: Math.round(stats.heapUsedPercent * 100) / 100,
          threshold: this.config.criticalThreshold,
          recommendation: 'Consider reducing batch size or enabling Node.js --expose-gc flag',
        });

        this.lastCriticalTime = now;

        // Trigger GC if enabled and available
        if (this.config.autoGC) {
          forceGC();
        }
      }
    }
    // Check for warning threshold
    else if (stats.heapUsedPercent >= this.config.warningThreshold) {
      if (now - this.lastWarningTime >= this.WARNING_COOLDOWN) {
        migrationLogger.warn('Memory usage high', {
          context,
          heapUsedMB: Math.round(stats.heapUsedMB * 100) / 100,
          heapTotalMB: Math.round(stats.heapTotalMB * 100) / 100,
          heapUsedPercent: Math.round(stats.heapUsedPercent * 100) / 100,
          threshold: this.config.warningThreshold,
        });

        this.lastWarningTime = now;
      }
    }
  }

  /**
   * Get current memory statistics
   */
  getCurrentStats(): MemoryStats {
    return getMemoryStats();
  }

  /**
   * Check if monitoring is active
   */
  isActive(): boolean {
    return this.isMonitoring;
  }
}

/**
 * Singleton instance for global memory monitoring
 */
let globalMonitor: MemoryMonitor | null = null;

/**
 * Get or create the global memory monitor
 */
export function getGlobalMemoryMonitor(config?: Partial<MemoryMonitorConfig>): MemoryMonitor {
  if (!globalMonitor) {
    globalMonitor = new MemoryMonitor(config);
  }
  return globalMonitor;
}
