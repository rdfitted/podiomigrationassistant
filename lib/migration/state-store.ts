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
 */
export class MigrationStateStore {
  private storePath: string;

  constructor(storePath = 'data/migrations') {
    this.storePath = storePath;
  }

  /**
   * Initialize the state store (ensure directory exists)
   */
  async initialize(): Promise<void> {
    try {
      await fs.mkdir(this.storePath, { recursive: true });
      logger.info('MigrationStateStore initialized', { storePath: this.storePath });
    } catch (error) {
      logger.error('Failed to initialize MigrationStateStore', { error });
      throw error;
    }
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
   */
  async saveMigrationJob(job: MigrationJob): Promise<void> {
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

        // Verify content matches (length check for performance)
        if (writtenContent.length !== jsonContent.length) {
          throw new Error(`Write verification failed: Size mismatch (expected ${jsonContent.length}, got ${writtenContent.length})`);
        }

        // Atomic rename (only after verification passes)
        await fs.rename(tempPath, jobPath);

        logger.debug('Saved migration job', {
          jobId: job.id,
          sizeBytes: jsonContent.length,
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
  }

  /**
   * Get migration job by ID
   */
  async getMigrationJob(jobId: string): Promise<MigrationJob | null> {
    const jobPath = this.getJobPath(jobId);

    try {
      const content = await fs.readFile(jobPath, 'utf-8');
      const job = JSON.parse(content) as MigrationJob;

      // Convert date strings back to Date objects
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

      return job;
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        logger.warn('Migration job not found', { jobId });
        return null;
      }

      // Handle JSON parse errors (corrupted files)
      if (error instanceof SyntaxError && error.message.includes('JSON')) {
        logger.error('Migration job file is corrupted (invalid JSON)', {
          jobId,
          filePath: jobPath,
          error: error.message,
        });

        // Create a backup of the corrupted file
        try {
          const backupPath = `${jobPath}.corrupted.${Date.now()}`;
          await fs.copyFile(jobPath, backupPath);
          logger.warn('Created backup of corrupted migration file', {
            jobId,
            backupPath,
          });
        } catch (backupError) {
          logger.error('Failed to create backup of corrupted file', {
            jobId,
            backupError,
          });
        }

        // Return null to allow the system to continue gracefully
        return null;
      }

      logger.error('Failed to read migration job', { jobId, error });
      throw error;
    }
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

    try {
      await fs.unlink(jobPath);
      logger.info('Deleted migration job', { jobId });
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.error('Failed to delete migration job', { jobId, error });
        throw error;
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
