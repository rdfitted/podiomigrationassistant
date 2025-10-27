/**
 * Failure Logger - Handles writing/reading failed items to/from log files
 *
 * Uses append-only writes (JSONL format) to avoid O(n²) complexity of
 * rewriting the entire migration state file for each failure.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { FailedItemDetail } from '../state-store';
import { logger } from '../logging';

/**
 * Failure logger for item migrations
 * Stores failed item details in JSONL format (one JSON object per line)
 */
export class FailureLogger {
  private baseLogPath: string;

  constructor(baseLogPath = 'logs/migrations') {
    this.baseLogPath = baseLogPath;
  }

  /**
   * Get the path to the failures log file for a job
   */
  private getFailuresLogPath(jobId: string): string {
    return path.join(this.baseLogPath, jobId, 'failures.log');
  }

  /**
   * Ensure the log directory exists for a job
   */
  private async ensureLogDirectory(jobId: string): Promise<void> {
    const logDir = path.join(this.baseLogPath, jobId);
    await fs.mkdir(logDir, { recursive: true });
  }

  /**
   * Write a single failed item to log file (append-only)
   * Uses JSONL format: one JSON object per line
   */
  async logFailedItem(jobId: string, item: FailedItemDetail): Promise<void> {
    try {
      await this.ensureLogDirectory(jobId);
      const logPath = this.getFailuresLogPath(jobId);

      // Serialize to single-line JSON
      const jsonLine = JSON.stringify(item) + '\n';

      // Append to file (no need to read entire file)
      await fs.appendFile(logPath, jsonLine, 'utf-8');

      logger.debug('Logged failed item', {
        jobId,
        sourceItemId: item.sourceItemId,
        errorCategory: item.errorCategory,
      });
    } catch (error) {
      logger.error('Failed to log failed item', {
        jobId,
        sourceItemId: item.sourceItemId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Read all failed items from log file
   * Used for retry operations and UI display
   */
  async getFailedItems(jobId: string): Promise<FailedItemDetail[]> {
    const logPath = this.getFailuresLogPath(jobId);

    try {
      const content = await fs.readFile(logPath, 'utf-8');

      // Handle empty file
      if (!content.trim()) {
        return [];
      }

      // Parse JSONL format (one JSON object per line)
      const lines = content.trim().split('\n');
      const items: FailedItemDetail[] = [];

      for (const line of lines) {
        if (line.trim()) {
          try {
            const item = JSON.parse(line) as FailedItemDetail;
            // Convert date strings back to Date objects
            item.firstAttemptAt = new Date(item.firstAttemptAt);
            item.lastAttemptAt = new Date(item.lastAttemptAt);
            items.push(item);
          } catch (parseError) {
            logger.warn('Failed to parse failed item line', {
              jobId,
              line,
              error: parseError instanceof Error ? parseError.message : String(parseError),
            });
            // Skip corrupted lines
          }
        }
      }

      logger.debug('Read failed items from log', {
        jobId,
        count: items.length,
      });

      return items;
    } catch (error) {
      // Handle file not found gracefully (e.g., fresh migration with no failures yet)
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        logger.debug('Failures log not found (no failures yet)', { jobId });
        return [];
      }

      logger.error('Failed to read failed items', {
        jobId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get failed items count without loading all items
   * Reads file line count for efficiency
   */
  async getFailedItemCount(jobId: string): Promise<number> {
    const logPath = this.getFailuresLogPath(jobId);

    try {
      const content = await fs.readFile(logPath, 'utf-8');

      // Handle empty file
      if (!content.trim()) {
        return 0;
      }

      // Count non-empty lines
      const lines = content.trim().split('\n');
      const count = lines.filter(line => line.trim()).length;

      logger.debug('Counted failed items', { jobId, count });
      return count;
    } catch (error) {
      // Handle file not found gracefully
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return 0;
      }

      logger.error('Failed to count failed items', {
        jobId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Clear failed items log (for retry operations)
   * Deletes the log file to start fresh
   */
  async clearFailedItems(jobId: string): Promise<void> {
    const logPath = this.getFailuresLogPath(jobId);

    try {
      await fs.unlink(logPath);
      logger.info('Cleared failed items log', { jobId });
    } catch (error) {
      // Ignore if file doesn't exist (already clear)
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.error('Failed to clear failed items log', {
          jobId,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    }
  }

  /**
   * Check if failures log exists for a job
   */
  async hasFailures(jobId: string): Promise<boolean> {
    const logPath = this.getFailuresLogPath(jobId);
    try {
      await fs.access(logPath);
      return true;
    } catch {
      return false;
    }
  }
}

// Export singleton instance
export const failureLogger = new FailureLogger();
