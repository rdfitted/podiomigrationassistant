import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { logger } from './logging';

/**
 * Migration job status types
 */
export type MigrationJobStatus = 'planning' | 'in_progress' | 'completed' | 'failed' | 'paused' | 'cancelled' | 'detecting' | 'waiting_approval' | 'deleting';

/**
 * Migration job types
 */
export type MigrationJobType = 'flow_clone' | 'item_migration' | 'cleanup';

/**
 * Migration step types
 */
export type MigrationStepType = 'clone_app' | 'clone_flow' | 'clone_hook' | 'update_references' | 'migrate_items';

/**
 * Migration step status
 */
export type MigrationStepStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

/**
 * Individual migration step
 */
export interface MigrationStep {
  id: string;
  type: MigrationStepType;
  sourceId: string;
  targetId?: string;
  status: MigrationStepStatus;
  error?: string;
  startedAt?: Date;
  completedAt?: Date;
}

/**
 * Migration error details
 */
export interface MigrationError {
  step: string;
  message: string;
  code?: string;
  timestamp: Date;
}

/**
 * Error category for classification
 */
export type ErrorCategory = 'network' | 'validation' | 'permission' | 'rate_limit' | 'duplicate' | 'unknown';

/**
 * Failed item details with retry tracking
 */
export interface FailedItemDetail {
  sourceItemId: number;
  targetItemId?: number;
  error: string;
  errorCategory: ErrorCategory;
  attemptCount: number;
  firstAttemptAt: Date;
  lastAttemptAt: Date;
}

/**
 * Batch checkpoint for resume capability
 */
export interface MigrationBatchCheckpoint {
  batchNumber: number;
  offset: number;
  limit: number;
  completedItemIds: number[]; // Target item IDs that were successfully created
  startedAt: Date;
  completedAt?: Date;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  itemsProcessed: number;
  itemsSuccessful: number;
  itemsFailed: number;
}

/**
 * Throughput metrics for ETA calculation
 */
export interface ThroughputMetrics {
  itemsPerSecond: number;
  batchesPerMinute: number;
  avgBatchDuration: number; // milliseconds
  estimatedCompletionTime?: Date;
  rateLimitPauses: number;
  totalRateLimitDelay: number; // milliseconds
}

/**
 * Migration progress snapshot (simple version for storing pre-retry state)
 */
export interface ProgressSnapshot {
  total: number;
  processed: number;
  successful: number;
  failed: number;
  percent: number;
  lastUpdate: Date;
}

/**
 * Migration progress snapshot
 */
export interface MigrationProgress {
  total: number;
  processed: number;
  successful: number;
  failed: number;
  percent: number;
  lastUpdate: Date;
  throughput?: ThroughputMetrics;
  batchCheckpoints?: MigrationBatchCheckpoint[];
  /** @deprecated Use failure-logger.ts to read failed items from log file instead */
  failedItems?: FailedItemDetail[];
  /** Failed items count by error category (summary only, details in logs/migrations/{jobId}/failures.log) */
  failedItemsByCategory?: Record<ErrorCategory, number>;
  /** Snapshot of progress before retry was initiated (for displaying pre-retry state) */
  preRetrySnapshot?: ProgressSnapshot;
}

/**
 * Complete migration job state
 */
export interface MigrationJob {
  id: string;
  jobType?: MigrationJobType;
  sourceSpaceId: string;
  targetSpaceId: string;
  status: MigrationJobStatus;
  startedAt: Date;
  completedAt?: Date;
  lastHeartbeat?: Date;
  steps: MigrationStep[];
  errors: MigrationError[];
  progress?: MigrationProgress;
  metadata?: {
    appCount?: number;
    flowCount?: number;
    hookCount?: number;
    [key: string]: unknown;
  };
}

/**
 * Migration state store with file-based persistence
 *
 * Stores migration job state in JSON files for tracking progress
 * and enabling recovery from failures.
 *
 * Features:
 * - Write queue to serialize all write operations (prevents concurrent write corruption)
 * - Retry logic for reads with exponential backoff
 * - Automatic backup before writes
 * - Recovery from corrupted files
 */
export class MigrationStateStore {
  private storePath: string;
  private writeQueue: Map<string, Promise<void>> = new Map();
  private backupPath: string;

  constructor(storePath = 'data/migrations') {
    this.storePath = storePath;
    this.backupPath = `${storePath}/.backups`;
  }

  /**
   * Initialize the state store (ensure directory exists)
   */
  async initialize(): Promise<void> {
    try {
      await fs.mkdir(this.storePath, { recursive: true });
      await fs.mkdir(this.backupPath, { recursive: true });
      logger.info('MigrationStateStore initialized', { storePath: this.storePath, backupPath: this.backupPath });
    } catch (error) {
      logger.error('Failed to initialize MigrationStateStore', { error });
      throw error;
    }
  }

  /**
   * Queue a write operation to prevent concurrent writes to the same file
   * This ensures all writes for a given jobId are serialized
   */
  private async queueWrite(jobId: string, writeOperation: () => Promise<void>): Promise<void> {
    const prev = this.writeQueue.get(jobId) ?? Promise.resolve();
    // Swallow previous errors so the chain continues
    const writePromise = prev.catch(() => void 0).then(() => writeOperation());
    this.writeQueue.set(jobId, writePromise);
    try {
      await writePromise;
    } finally {
      if (this.writeQueue.get(jobId) === writePromise) {
        this.writeQueue.delete(jobId);
      }
    }
  }

  /**
   * Create a backup of the job file before writing
   */
  private async createBackup(jobId: string): Promise<void> {
    const jobPath = this.getJobPath(jobId);
    const backupFilePath = path.join(this.backupPath, `${jobId}.backup.json`);

    try {
      // Ensure backup directory exists
      await fs.mkdir(this.backupPath, { recursive: true });

      // Check if job file exists
      await fs.access(jobPath);

      // Read and validate JSON before overwriting stable backup
      const content = await fs.readFile(jobPath, 'utf-8');
      try {
        JSON.parse(content);
        // Valid JSON — persist exactly what we validated (avoids TOCTOU)
        const tmp = `${backupFilePath}.${randomUUID()}.tmp`;
        await fs.writeFile(tmp, content, 'utf8');
        const fh = await fs.open(tmp, 'r+');
        try {
          await fh.sync();
        } finally {
          await fh.close();
        }
        await fs.rename(tmp, backupFilePath);
      } catch {
        // Corrupted source - save with distinct name to avoid overwriting good backup
        const corruptedBackupPath = path.join(this.backupPath, `${jobId}.backup.corrupted.${Date.now()}.json`);
        await fs.writeFile(corruptedBackupPath, content, 'utf8');
        logger.warn('Skipped overwriting stable backup with corrupted source', { jobId, corruptedBackupPath });
        return;
      }
      logger.debug('Created backup for job', { jobId });
    } catch (error: any) {
      // If file doesn't exist (ENOENT), that's okay - no backup needed
      if (error?.code !== 'ENOENT') {
        logger.warn('Failed to create backup', { jobId, error: error?.message });
      }
    }
  }

  /**
   * Attempt to recover a corrupted job file from backup
   */
  private async recoverFromBackup(jobId: string): Promise<MigrationJob | null> {
    const backupFilePath = path.join(this.backupPath, `${jobId}.backup.json`);

    try {
      const content = await fs.readFile(backupFilePath, 'utf-8');
      const job = JSON.parse(content) as MigrationJob;

      logger.warn('Recovered job from backup', { jobId });

      // Convert date strings back to Date objects
      return this.deserializeJob(job);
    } catch (error: any) {
      logger.error('Failed to recover from backup', { jobId, error: error?.message });
      return null;
    }
  }

  /**
   * Convert date strings back to Date objects
   */
  private deserializeJob(job: MigrationJob): MigrationJob {
    job.startedAt = new Date(job.startedAt);
    if (job.completedAt) {
      job.completedAt = new Date(job.completedAt);
    }
    if (job.lastHeartbeat) {
      job.lastHeartbeat = new Date(job.lastHeartbeat);
    }
    if (job.progress?.lastUpdate) {
      job.progress.lastUpdate = new Date(job.progress.lastUpdate);
    }
    job.errors = job.errors.map(err => ({
      ...err,
      timestamp: new Date(err.timestamp),
    }));
    job.steps = job.steps.map(step => ({
      ...step,
      startedAt: step.startedAt ? new Date(step.startedAt) : undefined,
      completedAt: step.completedAt ? new Date(step.completedAt) : undefined,
    }));

    // Convert nested date fields in progress object
    if (job.progress) {
      if (job.progress.throughput?.estimatedCompletionTime) {
        job.progress.throughput.estimatedCompletionTime = new Date(job.progress.throughput.estimatedCompletionTime);
      }

      if (job.progress.preRetrySnapshot?.lastUpdate) {
        job.progress.preRetrySnapshot.lastUpdate = new Date(job.progress.preRetrySnapshot.lastUpdate);
      }

      if (job.progress.batchCheckpoints) {
        job.progress.batchCheckpoints = job.progress.batchCheckpoints.map(checkpoint => ({
          ...checkpoint,
          startedAt: new Date(checkpoint.startedAt),
          completedAt: checkpoint.completedAt ? new Date(checkpoint.completedAt) : undefined,
        }));
      }

      if (job.progress.failedItems) {
        job.progress.failedItems = job.progress.failedItems.map(item => ({
          ...item,
          firstAttemptAt: new Date(item.firstAttemptAt),
          lastAttemptAt: new Date(item.lastAttemptAt),
        }));
      }
    }

    return job;
  }

  /**
   * Create a new migration job
   */
  async createMigrationJob(
    sourceSpaceId: string,
    targetSpaceId: string,
    metadata?: Record<string, unknown>
  ): Promise<MigrationJob> {
    // Extract jobType from metadata if present for top-level field
    const jobType = metadata?.jobType as MigrationJobType | undefined;

    const job: MigrationJob = {
      id: randomUUID(),
      jobType,
      sourceSpaceId,
      targetSpaceId,
      status: 'planning',
      startedAt: new Date(),
      steps: [],
      errors: [],
      metadata,
    };

    await this.saveMigrationJob(job);
    logger.info('Created migration job', { jobId: job.id, jobType, sourceSpaceId, targetSpaceId });
    return job;
  }

  /**
   * Save migration job to disk with atomic write, verification, and retry
   * Now uses write queue to prevent concurrent writes and creates backups
   */
  async saveMigrationJob(job: MigrationJob, opts: { skipBackup?: boolean } = {}): Promise<void> {
    // Queue the write operation to prevent concurrent writes
    await this.queueWrite(job.id, async () => {
      // Create backup before writing unless explicitly skipped (e.g., recovery)
      if (!opts.skipBackup) {
        await this.createBackup(job.id);
      }

      const jobPath = this.getJobPath(job.id);
      // Use unique temp path to prevent concurrent write collisions
      const tempPath = `${jobPath}.${randomUUID()}.tmp`;
      const MAX_RETRIES = 3;
      let lastError: Error | null = null;

      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          // Ensure directory exists
          await fs.mkdir(this.storePath, { recursive: true });

          // Serialize to JSON
          const jsonContent = JSON.stringify(job, null, 2);
          const expectedBytes = Buffer.byteLength(jsonContent, 'utf8');

          // Write to temp file
          await fs.writeFile(tempPath, jsonContent, 'utf-8');

          // Force flush to disk (fsync)
          const fileHandle = await fs.open(tempPath, 'r+');
          try {
            await fileHandle.sync();
          } finally {
            await fileHandle.close();
          }

          // Verify write by reading back and parsing
          const writtenContent = await fs.readFile(tempPath, 'utf-8');
          try {
            JSON.parse(writtenContent); // Validate JSON structure
          } catch (parseError) {
            throw new Error(`Write verification failed: Invalid JSON in temp file - ${parseError}`);
          }

          // Verify content matches (byte-length check)
          const writtenBytes = Buffer.byteLength(writtenContent, 'utf8');
          if (writtenBytes !== expectedBytes) {
            throw new Error(`Write verification failed: Size mismatch (expected ${expectedBytes}, got ${writtenBytes})`);
          }

          // Atomic rename (only after verification passes)
          await fs.rename(tempPath, jobPath);

          // Best-effort fsync of parent directory to persist the rename
          try {
            const dirHandle = await fs.open(this.storePath, 'r');
            try {
              await dirHandle.sync();
            } finally {
              await dirHandle.close();
            }
          } catch {
            // Ignore if not supported on this platform
          }

          logger.debug('Saved migration job', {
            jobId: job.id,
            sizeBytes: expectedBytes,
            attempt: attempt > 1 ? attempt : undefined,
          });

          return; // Success!
        } catch (error) {
          lastError = error as Error;

          // With unique temp files, cross-writer rename collisions are eliminated
          // Log retry attempt
          if (attempt < MAX_RETRIES) {
            logger.warn('Failed to save migration job, retrying', {
              jobId: job.id,
              attempt,
              maxRetries: MAX_RETRIES,
              error: lastError.message,
            });

            // Clean up temp file before retry
            try {
              await fs.unlink(tempPath);
            } catch {
              // Ignore cleanup errors
            }

            // Wait before retry (exponential backoff: 100ms, 200ms, 400ms)
            await new Promise(resolve => setTimeout(resolve, 100 * Math.pow(2, attempt - 1)));
          }
        }
      }

      // All retries failed
      logger.error('Failed to save migration job after all retries', {
        jobId: job.id,
        attempts: MAX_RETRIES,
        error: lastError,
      });

      // Clean up temp file
      try {
        await fs.unlink(tempPath);
      } catch {
        // Ignore cleanup errors
      }

      throw lastError || new Error('Failed to save migration job');
    });
  }

  /**
   * Get migration job by ID
   */
  async getMigrationJob(jobId: string): Promise<MigrationJob | null> {
    const jobPath = this.getJobPath(jobId);
    const MAX_RETRIES = 5;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        // Wait for any pending writes to this job to complete
        const pendingWrite = this.writeQueue.get(jobId);
        if (pendingWrite) {
          try {
            await pendingWrite;
          } catch {
            // Continue even if write failed - we'll try to read anyway
          }
        }

        const content = await fs.readFile(jobPath, 'utf-8');
        const job = JSON.parse(content) as MigrationJob;

        // Convert date strings back to Date objects using our helper
        return this.deserializeJob(job);
      } catch (error: unknown) {
        lastError = error as Error;

        // If file doesn't exist, return null immediately (no retry needed)
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          if (attempt === 1) {
            logger.debug('Migration job not found', { jobId });
          }
          return null;
        }

        // Handle JSON parse errors (corrupted files)
        if (error instanceof SyntaxError) {
          logger.error('JSON parse error - file may be corrupted', {
            jobId,
            attempt,
            maxRetries: MAX_RETRIES,
            filePath: jobPath,
            error: (error as Error).message,
          });

          // On first parse error, try to recover from backup
          if (attempt === 1) {
            // Create a backup of the corrupted file
            try {
              const corruptedBackupPath = `${jobPath}.corrupted.${Date.now()}`;
              await fs.copyFile(jobPath, corruptedBackupPath);
              logger.warn('Created backup of corrupted migration file', {
                jobId,
                backupPath: corruptedBackupPath,
              });
            } catch (backupError) {
              logger.error('Failed to create backup of corrupted file', {
                jobId,
                backupError,
              });
            }

            // Try to recover from our automatic backup
            const recovered = await this.recoverFromBackup(jobId);
            if (recovered) {
              // Restore the recovered version to the main file
              try {
                await this.saveMigrationJob(recovered, { skipBackup: true });
                logger.info('Successfully recovered and restored corrupted job file', { jobId });
                return recovered;
              } catch (saveError) {
                logger.error('Failed to restore recovered job', { jobId, error: saveError });
              }
            }
          }
        }

        // Retry with exponential backoff (50ms, 100ms, 200ms, 400ms, 800ms)
        if (attempt < MAX_RETRIES) {
          const backoffMs = 50 * Math.pow(2, attempt - 1);
          logger.warn('Failed to read migration job, retrying', {
            jobId,
            attempt,
            maxRetries: MAX_RETRIES,
            backoffMs,
            errorType: error instanceof SyntaxError ? 'JSON parse error' : 'read error',
            error: (error as Error).message,
          });
          await new Promise(resolve => setTimeout(resolve, backoffMs));
        }
      }
    }

    // All retries failed
    logger.error('Failed to get migration job after all retries', {
      jobId,
      attempts: MAX_RETRIES,
      error: lastError,
    });

    // Return null to allow the system to continue gracefully
    // The caller can decide how to handle the missing job
    return null;
  }

  /**
   * List all migration jobs
   */
  async listMigrationJobs(): Promise<MigrationJob[]> {
    try {
      const files = await fs.readdir(this.storePath);
      const jobFiles = files.filter(f => f.endsWith('.json'));

      const jobs = await Promise.all(
        jobFiles.map(async (file) => {
          const jobId = file.replace('.json', '');
          return this.getMigrationJob(jobId);
        })
      );

      return jobs.filter((job): job is MigrationJob => job !== null);
    } catch (error) {
      logger.error('Failed to list migration jobs', { error });
      throw error;
    }
  }

  /**
   * Update migration job status
   */
  async updateJobStatus(
    jobId: string,
    status: MigrationJobStatus,
    completedAt?: Date
  ): Promise<void> {
    const job = await this.getMigrationJob(jobId);
    if (!job) {
      throw new Error(`Migration job not found: ${jobId}`);
    }

    job.status = status;
    if (completedAt) {
      job.completedAt = completedAt;
    }

    // Seed heartbeat when entering in_progress, clear on terminal/pause states
    if (status === 'in_progress') {
      job.lastHeartbeat = new Date();
    } else if (status === 'completed' || status === 'failed' || status === 'cancelled' || status === 'paused') {
      job.lastHeartbeat = undefined;
    }

    await this.saveMigrationJob(job);
    logger.info('Updated migration job status', { jobId, status });
  }

  /**
   * Add a step to a migration job
   */
  async addMigrationStep(
    jobId: string,
    type: MigrationStepType,
    sourceId: string
  ): Promise<string> {
    const job = await this.getMigrationJob(jobId);
    if (!job) {
      throw new Error(`Migration job not found: ${jobId}`);
    }

    const step: MigrationStep = {
      id: randomUUID(),
      type,
      sourceId,
      status: 'pending',
    };

    job.steps.push(step);
    await this.saveMigrationJob(job);

    logger.debug('Added migration step', { jobId, stepId: step.id, type, sourceId });
    return step.id;
  }

  /**
   * Update a migration step
   */
  async updateMigrationStep(
    jobId: string,
    stepId: string,
    update: Partial<MigrationStep>
  ): Promise<void> {
    const job = await this.getMigrationJob(jobId);
    if (!job) {
      throw new Error(`Migration job not found: ${jobId}`);
    }

    const stepIndex = job.steps.findIndex(s => s.id === stepId);
    if (stepIndex === -1) {
      throw new Error(`Migration step not found: ${stepId}`);
    }

    job.steps[stepIndex] = {
      ...job.steps[stepIndex],
      ...update,
    };

    await this.saveMigrationJob(job);
    logger.debug('Updated migration step', { jobId, stepId, update });
  }

  /**
   * Add an error to a migration job
   */
  async addMigrationError(
    jobId: string,
    step: string,
    message: string,
    code?: string
  ): Promise<void> {
    const job = await this.getMigrationJob(jobId);
    if (!job) {
      throw new Error(`Migration job not found: ${jobId}`);
    }

    job.errors.push({
      step,
      message,
      code,
      timestamp: new Date(),
    });

    await this.saveMigrationJob(job);
    logger.error('Added migration error', { jobId, step, message, code });
  }

  /**
   * Update migration job progress
   */
  async updateJobProgress(
    jobId: string,
    progress: MigrationProgress
  ): Promise<void> {
    const job = await this.getMigrationJob(jobId);
    if (!job) {
      throw new Error(`Migration job not found: ${jobId}`);
    }

    const mergedProgress: MigrationProgress = {
      ...job.progress,
      ...progress,
    };

    if (job.progress?.failedItemsByCategory || progress.failedItemsByCategory) {
      mergedProgress.failedItemsByCategory = {
        ...(job.progress?.failedItemsByCategory ?? {}),
        ...(progress.failedItemsByCategory ?? {}),
      } as Record<ErrorCategory, number>;
    }

    if (!progress.failedItems && job.progress?.failedItems && !mergedProgress.failedItems) {
      mergedProgress.failedItems = job.progress.failedItems;
    }

    job.progress = mergedProgress;
    await this.saveMigrationJob(job);
    logger.debug('Updated migration job progress', { jobId, progress });
  }

  /**
   * Update migration job metadata
   */
  async updateJobMetadata(
    jobId: string,
    metadata: Record<string, unknown>
  ): Promise<void> {
    const job = await this.getMigrationJob(jobId);
    if (!job) {
      throw new Error(`Migration job not found: ${jobId}`);
    }

    // Merge new metadata with existing
    job.metadata = {
      ...job.metadata,
      ...metadata,
    };
    await this.saveMigrationJob(job);
    logger.debug('Updated migration job metadata', { jobId, metadata });
  }

  /**
   * Delete a migration job
   */
  async deleteMigrationJob(jobId: string): Promise<void> {
    const jobPath = this.getJobPath(jobId);
    const backupFilePath = path.join(this.backupPath, `${jobId}.backup.json`);

    try {
      await fs.unlink(jobPath);
      logger.info('Deleted migration job', { jobId });
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.error('Failed to delete migration job', { jobId, error });
        throw error;
      }
    }

    // Best-effort cleanup of backup
    try {
      await fs.unlink(backupFilePath);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.warn('Failed to delete job backup', { jobId, error });
      }
    }
  }

  /**
   * Add or update a batch checkpoint
   */
  async saveBatchCheckpoint(
    jobId: string,
    checkpoint: MigrationBatchCheckpoint
  ): Promise<void> {
    const job = await this.getMigrationJob(jobId);
    if (!job) {
      throw new Error(`Migration job not found: ${jobId}`);
    }

    if (!job.progress) {
      job.progress = {
        total: 0,
        processed: 0,
        successful: 0,
        failed: 0,
        percent: 0,
        lastUpdate: new Date(),
      };
    }

    if (!job.progress.batchCheckpoints) {
      job.progress.batchCheckpoints = [];
    }

    // Find existing checkpoint for this batch number
    const existingIndex = job.progress.batchCheckpoints.findIndex(
      (c) => c.batchNumber === checkpoint.batchNumber
    );

    if (existingIndex >= 0) {
      // Update existing checkpoint
      job.progress.batchCheckpoints[existingIndex] = checkpoint;
    } else {
      // Add new checkpoint
      job.progress.batchCheckpoints.push(checkpoint);
    }

    await this.saveMigrationJob(job);
    logger.debug('Saved batch checkpoint', {
      jobId,
      batchNumber: checkpoint.batchNumber,
      status: checkpoint.status,
    });
  }

  /**
   * Get the latest batch checkpoint for a migration
   */
  async getLatestBatchCheckpoint(jobId: string): Promise<MigrationBatchCheckpoint | null> {
    const job = await this.getMigrationJob(jobId);
    if (!job?.progress?.batchCheckpoints || job.progress.batchCheckpoints.length === 0) {
      return null;
    }

    // Return checkpoint with highest batch number
    return job.progress.batchCheckpoints.reduce((latest, current) =>
      current.batchNumber > latest.batchNumber ? current : latest
    );
  }

  /**
   * Increment failed item count by error category
   * Used instead of storing full failed item details in state
   * Full details are stored in logs/migrations/{jobId}/failures.log
   */
  async incrementFailedItemCount(
    jobId: string,
    errorCategory: ErrorCategory
  ): Promise<void> {
    await this.incrementFailedItemCounts(jobId, { [errorCategory]: 1 });
  }

  async incrementFailedItemCounts(
    jobId: string,
    counts: Partial<Record<ErrorCategory, number>>
  ): Promise<void> {
    const entries: Array<[ErrorCategory, number]> = [];
    for (const [category, value] of Object.entries(counts)) {
      if (!value || value <= 0) {
        continue;
      }
      entries.push([category as ErrorCategory, value]);
    }

    if (entries.length === 0) {
      return;
    }

    const job = await this.getMigrationJob(jobId);
    if (!job) {
      throw new Error(`Migration job not found: ${jobId}`);
    }

    if (!job.progress) {
      job.progress = {
        total: 0,
        processed: 0,
        successful: 0,
        failed: 0,
        percent: 0,
        lastUpdate: new Date(),
      };
    }

    if (!job.progress.failedItemsByCategory) {
      job.progress.failedItemsByCategory = {
        network: 0,
        validation: 0,
        permission: 0,
        rate_limit: 0,
        duplicate: 0,
        unknown: 0,
      };
    }

    let totalIncrement = 0;
    for (const [category, value] of entries) {
      job.progress.failedItemsByCategory[category] =
        (job.progress.failedItemsByCategory[category] || 0) + value;
      totalIncrement += value;
    }

    job.progress.failed = (job.progress.failed || 0) + totalIncrement;
    job.progress.lastUpdate = new Date();

    await this.saveMigrationJob(job);
    logger.debug('Incremented failed item counts', {
      jobId,
      updates: entries,
      totalFailed: job.progress.failed,
    });
  }

  /**
   * @deprecated Use incrementFailedItemCount() and failure-logger.ts instead
   * This method is kept for backward compatibility but should not be used
   */
  async addFailedItem(
    jobId: string,
    failedItem: FailedItemDetail
  ): Promise<void> {
    logger.warn('addFailedItem() is deprecated - use incrementFailedItemCount() + failure-logger.ts instead', {
      jobId,
      sourceItemId: failedItem.sourceItemId,
    });

    // Forward to new method for backward compatibility
    await this.incrementFailedItemCount(jobId, failedItem.errorCategory);
  }

  /**
   * Update throughput metrics
   */
  async updateThroughputMetrics(
    jobId: string,
    metrics: ThroughputMetrics
  ): Promise<void> {
    const job = await this.getMigrationJob(jobId);
    if (!job) {
      throw new Error(`Migration job not found: ${jobId}`);
    }

    if (!job.progress) {
      job.progress = {
        total: 0,
        processed: 0,
        successful: 0,
        failed: 0,
        percent: 0,
        lastUpdate: new Date(),
      };
    }

    job.progress.throughput = metrics;
    await this.saveMigrationJob(job);
    logger.debug('Updated throughput metrics', { jobId, metrics });
  }

  /**
   * Get the file path for a job ID
   */
  private getJobPath(jobId: string): string {
    return path.join(this.storePath, `${jobId}.json`);
  }
}

// Export singleton instance
export const migrationStateStore = new MigrationStateStore();
