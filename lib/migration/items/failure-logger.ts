/**
 * Failure Logger - Handles writing/reading failed items to/from log files
 *
 * Uses append-only writes (JSONL format) to avoid O(n^2) complexity of
 * rewriting the entire migration state file for each failure.
 * The base directory can be overridden via MIGRATION_FAILURE_LOG_DIR.
 */

import { createReadStream, promises as fs } from 'node:fs';
import readline from 'node:readline';
import path from 'node:path';
import { FailedItemDetail } from '../state-store';
import { logger } from '../logging';

const LOG_ROOT_CONFIG = process.env.MIGRATION_FAILURE_LOG_DIR || 'logs/migrations';
const DEFAULT_LOG_ROOT = path.resolve(process.cwd(), LOG_ROOT_CONFIG);

/**
 * Failure logger for item migrations
 * Stores failed item details in JSONL format (one JSON object per line)
 */
export class FailureLogger {
  private baseLogPath: string;
  private writeQueue = new Map<string, Promise<void>>();

  constructor(baseLogPath = DEFAULT_LOG_ROOT) {
    this.baseLogPath = path.resolve(baseLogPath);
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

  private async enqueueWrite(jobId: string, task: () => Promise<void>): Promise<void> {
    const previous = this.writeQueue.get(jobId) ?? Promise.resolve();
    const next = previous.catch((error) => {
      logger.error('Previous failure log write failed - continuing', {
        jobId,
        error: error instanceof Error ? error.message : String(error),
      });
    }).then(task);

    this.writeQueue.set(jobId, next);

    try {
      await next;
    } finally {
      if (this.writeQueue.get(jobId) === next) {
        this.writeQueue.delete(jobId);
      }
    }
  }

  private parseFailedItem(line: string, jobId: string): FailedItemDetail | null {
    const trimmed = line.trim();
    if (!trimmed) {
      return null;
    }

    try {
      const item = JSON.parse(trimmed) as FailedItemDetail;
      item.firstAttemptAt = new Date(item.firstAttemptAt);
      item.lastAttemptAt = new Date(item.lastAttemptAt);
      return item;
    } catch (parseError) {
      logger.warn('Failed to parse failed item line', {
        jobId,
        line: trimmed,
        error: parseError instanceof Error ? parseError.message : String(parseError),
      });
      return null;
    }
  }

  /**
   * Write a single failed item to log file (append-only)
   * Uses JSONL format: one JSON object per line
   */
  async logFailedItem(jobId: string, item: FailedItemDetail): Promise<void> {
    try {
      await this.enqueueWrite(jobId, async () => {
        await this.ensureLogDirectory(jobId);
        const logPath = this.getFailuresLogPath(jobId);
        const jsonLine = JSON.stringify(item) + '\n';

        await fs.appendFile(logPath, jsonLine, { encoding: 'utf8', flag: 'a', mode: 0o640 });
      });

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
   * Write multiple failed items to the log in one append
   */
  async logFailedItemsBulk(jobId: string, items: FailedItemDetail[]): Promise<void> {
    if (items.length === 0) {
      return;
    }

    try {
      await this.enqueueWrite(jobId, async () => {
        await this.ensureLogDirectory(jobId);
        const logPath = this.getFailuresLogPath(jobId);
        const jsonLines = items.map(item => JSON.stringify(item)).join('\n') + '\n';

        await fs.appendFile(logPath, jsonLines, { encoding: 'utf8', flag: 'a', mode: 0o640 });
      });

      logger.debug('Logged failed items in bulk', { jobId, count: items.length });
    } catch (error) {
      logger.error('Failed to log failed items in bulk', {
        jobId,
        count: items.length,
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

      if (!content.trim()) {
        return [];
      }

      const lines = content.trim().split('\n');
      const items: FailedItemDetail[] = [];

      for (const line of lines) {
        const parsed = this.parseFailedItem(line, jobId);
        if (parsed) {
          items.push(parsed);
        }
      }

      logger.debug('Read failed items from log', { jobId, count: items.length });
      return items;
    } catch (error) {
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

  async getFailedItemIds(jobId: string): Promise<number[]> {
    const logPath = this.getFailuresLogPath(jobId);
    const ids: number[] = [];

    try {
      const rl = readline.createInterface({
        input: createReadStream(logPath, { encoding: 'utf8' }),
        crlfDelay: Infinity,
      });

      try {
        for await (const line of rl) {
          const parsed = this.parseFailedItem(line, jobId);
          if (parsed && typeof parsed.sourceItemId === 'number') {
            ids.push(parsed.sourceItemId);
          }
        }
      } finally {
        rl.close();
      }

      logger.debug('Loaded failed item IDs', { jobId, count: ids.length });
      return ids;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }

      logger.error('Failed to load failed item IDs', {
        jobId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get failed items count without loading all items
   * Streams the file to count entries for efficiency
   */
  async getFailedItemCount(jobId: string): Promise<number> {
    return this.getFailedCount(jobId);
  }

  async getFailedCount(jobId: string): Promise<number> {
    const logPath = this.getFailuresLogPath(jobId);

    try {
      const rl = readline.createInterface({
        input: createReadStream(logPath, { encoding: 'utf8' }),
        crlfDelay: Infinity,
      });

      let count = 0;

      try {
        for await (const line of rl) {
          if (line.trim()) {
            count += 1;
          }
        }
      } finally {
        rl.close();
      }

      logger.debug('Counted failed items', { jobId, count });
      return count;
    } catch (error) {
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
   * Truncates the file to preserve handles held by other readers
   */
  async clearFailedItems(jobId: string): Promise<void> {
    const logPath = this.getFailuresLogPath(jobId);

    try {
      await fs.truncate(logPath, 0);
      logger.info('Cleared failed items log', { jobId });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return;
      }

      logger.error('Failed to clear failed items log', {
        jobId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
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
