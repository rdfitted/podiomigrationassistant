/**
 * Log Configuration for Migration System
 *
 * Provides configuration for file-based logging with rotation, compression,
 * and structured output for multi-day migration operations.
 */

import path from 'path';
import { promises as fs } from 'fs';

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export interface LogConfig {
  /** Base directory for all logs */
  baseDir: string;
  /** Log level threshold */
  level: LogLevel;
  /** Maximum file size before rotation (bytes) */
  maxFileSize: number;
  /** Maximum age of log files (days) */
  maxAge: number;
  /** Whether to compress rotated logs */
  compress: boolean;
  /** Whether to log to console in addition to files */
  consoleEnabled: boolean;
}

export interface MigrationLogPaths {
  /** Directory for this migration's logs */
  migrationDir: string;
  /** Main migration events log */
  migrationLog: string;
  /** Per-item tracking log */
  itemsLog: string;
  /** Batch-level progress log */
  batchesLog: string;
  /** Detailed error traces log */
  errorsLog: string;
  /** Prefetch cache build log (UPDATE mode) */
  prefetchLog: string;
  /** Match lookup attempts log (UPDATE mode) */
  matchesLog: string;
  /** Update operations log (UPDATE mode) */
  updatesLog: string;
  /** All failures log (UPDATE mode) */
  failuresLog: string;
  /** Real-time statistics log (UPDATE mode) */
  statsLog: string;
}

const LOG_LEVEL_VALUES: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

/**
 * Default log configuration
 */
export const DEFAULT_LOG_CONFIG: LogConfig = {
  baseDir: path.join(process.cwd(), 'logs', 'migrations'),
  level: process.env.LOG_LEVEL === 'DEBUG' ? 'DEBUG' : 'INFO',
  maxFileSize: 50 * 1024 * 1024, // 50MB
  maxAge: 30, // 30 days
  compress: true,
  consoleEnabled: process.env.NODE_ENV === 'development',
};

/**
 * Get log paths for a specific migration
 */
export function getMigrationLogPaths(migrationId: string): MigrationLogPaths {
  // Sanitize migrationId to prevent path traversal and invalid filenames
  const safeId = migrationId.replace(/[^a-zA-Z0-9._-]/g, '_');
  const migrationDir = path.join(DEFAULT_LOG_CONFIG.baseDir, safeId);

  return {
    migrationDir,
    migrationLog: path.join(migrationDir, 'migration.log'),
    itemsLog: path.join(migrationDir, 'items.log'),
    batchesLog: path.join(migrationDir, 'batches.log'),
    errorsLog: path.join(migrationDir, 'errors.log'),
    prefetchLog: path.join(migrationDir, 'prefetch.log'),
    matchesLog: path.join(migrationDir, 'matches.log'),
    updatesLog: path.join(migrationDir, 'updates.log'),
    failuresLog: path.join(migrationDir, 'failures.log'),
    statsLog: path.join(migrationDir, 'stats.log'),
  };
}

/**
 * Ensure log directory exists
 */
export async function ensureLogDirectory(dirPath: string): Promise<void> {
  try {
    await fs.mkdir(dirPath, { recursive: true });
  } catch (error) {
    console.error(`Failed to create log directory ${dirPath}:`, error);
    throw error;
  }
}

/**
 * Check if a log level should be logged based on configuration
 */
export function shouldLog(level: LogLevel, config: LogConfig = DEFAULT_LOG_CONFIG): boolean {
  return LOG_LEVEL_VALUES[level] >= LOG_LEVEL_VALUES[config.level];
}

/**
 * Format log level for output
 */
export function formatLogLevel(level: LogLevel): string {
  return level.padEnd(5, ' ');
}

/**
 * Get timestamp in ISO format
 */
export function getTimestamp(): string {
  return new Date().toISOString();
}

/**
 * Check if a file needs rotation based on size
 */
export async function needsRotation(filePath: string, maxSize: number): Promise<boolean> {
  try {
    const stats = await fs.stat(filePath);
    return stats.size >= maxSize;
  } catch (error) {
    // File doesn't exist yet
    return false;
  }
}

/**
 * Rotate a log file (rename with timestamp)
 */
export async function rotateLogFile(filePath: string): Promise<void> {
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const rotatedPath = `${filePath}.${timestamp}`;
    await fs.rename(filePath, rotatedPath);
  } catch (error) {
    console.error(`Failed to rotate log file ${filePath}:`, error);
  }
}

/**
 * Clean up old log files
 */
export async function cleanupOldLogs(migrationDir: string, maxAge: number): Promise<void> {
  try {
    const files = await fs.readdir(migrationDir);
    const now = Date.now();
    const maxAgeMs = maxAge * 24 * 60 * 60 * 1000;

    for (const file of files) {
      // Skip current log files (no timestamp in name)
      if (!file.includes('.log.')) continue;

      const filePath = path.join(migrationDir, file);
      const stats = await fs.stat(filePath);
      const age = now - stats.mtimeMs;

      if (age > maxAgeMs) {
        await fs.unlink(filePath);
      }
    }
  } catch (error) {
    console.error(`Failed to cleanup old logs in ${migrationDir}:`, error);
  }
}
