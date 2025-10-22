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
  failedItems?: FailedItemDetail[];
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
   * Save migration job to disk with atomic write
   */
  async saveMigrationJob(job: MigrationJob): Promise<void> {
    const jobPath = this.getJobPath(job.id);
    const tempPath = `${jobPath}.tmp`;

    try {
      // Ensure directory exists
      await fs.mkdir(this.storePath, { recursive: true });

      // Write to temp file first
      await fs.writeFile(tempPath, JSON.stringify(job, null, 2), 'utf-8');

      // Atomic rename
      await fs.rename(tempPath, jobPath);

      logger.debug('Saved migration job', { jobId: job.id });
    } catch (error) {
      // Handle race condition: if temp file doesn't exist, it might have been
      // renamed by a concurrent save operation. Check if final file exists.
      const isRenameError = (error as NodeJS.ErrnoException).code === 'ENOENT' &&
                           (error as NodeJS.ErrnoException).syscall === 'rename';

      if (isRenameError) {
        try {
          // Check if final file exists (concurrent save succeeded)
          await fs.access(jobPath);
          logger.debug('Saved migration job (concurrent save detected)', { jobId: job.id });
          return; // Final file exists, consider this a success
        } catch {
          // Final file doesn't exist either, this is a real error
        }
      }

      logger.error('Failed to save migration job', { jobId: job.id, error });

      // Clean up temp file if it exists
      try {
        await fs.unlink(tempPath);
      } catch {
        // Ignore cleanup errors
      }

      throw error;
    }
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

    job.progress = progress;
    await this.saveMigrationJob(job);
    logger.debug('Updated migration job progress', { jobId, progress });
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
   * Add a failed item to the migration
   */
  async addFailedItem(
    jobId: string,
    failedItem: FailedItemDetail
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

    if (!job.progress.failedItems) {
      job.progress.failedItems = [];
    }

    // Check if this item already exists (by sourceItemId)
    const existingIndex = job.progress.failedItems.findIndex(
      (item) => item.sourceItemId === failedItem.sourceItemId
    );

    if (existingIndex >= 0) {
      // Update existing failed item (increment attempt count)
      job.progress.failedItems[existingIndex] = failedItem;
    } else {
      // Add new failed item
      job.progress.failedItems.push(failedItem);
    }

    await this.saveMigrationJob(job);
    logger.debug('Added failed item', {
      jobId,
      sourceItemId: failedItem.sourceItemId,
      attemptCount: failedItem.attemptCount,
    });
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
