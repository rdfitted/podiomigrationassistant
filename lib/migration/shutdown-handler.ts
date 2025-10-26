/**
 * Graceful Shutdown Handler for Migration System
 *
 * Handles process signals (SIGTERM, SIGINT) and UI-triggered pause requests
 * to gracefully stop migrations, complete current batch, save checkpoints,
 * and flush logs before exit.
 */

import { migrationStateStore } from './state-store';
import { shutdownAllLoggers } from './file-logger';
import { logger } from './logging';
import { isJobActive } from './job-lifecycle';

/**
 * Pause request registry for UI-triggered pauses
 */
class PauseRequestRegistry {
  private pauseRequests: Set<string> = new Set();

  /**
   * Request a migration to pause gracefully
   */
  requestPause(migrationId: string): void {
    this.pauseRequests.add(migrationId);
    logger.info('Pause requested for migration', { migrationId });
  }

  /**
   * Check if pause was requested for a migration
   */
  isPauseRequested(migrationId: string): boolean {
    return this.pauseRequests.has(migrationId);
  }

  /**
   * Clear pause request (after migration paused)
   */
  clearPauseRequest(migrationId: string): void {
    this.pauseRequests.delete(migrationId);
  }

  /**
   * Get all pending pause requests
   */
  getPendingRequests(): string[] {
    return Array.from(this.pauseRequests);
  }
}

// Global pause registry
const pauseRegistry = new PauseRequestRegistry();

/**
 * Shutdown coordinator for managing graceful shutdowns
 */
class ShutdownCoordinator {
  private isShuttingDown: boolean = false;
  private activeMigrations: Set<string> = new Set();
  private shutdownCallbacks: Map<string, () => Promise<void>> = new Map();
  private signalHandlersRegistered: boolean = false;

  /**
   * Register a migration as active
   */
  registerActiveMigration(migrationId: string): void {
    this.activeMigrations.add(migrationId);
    logger.debug('Registered active migration', { migrationId, total: this.activeMigrations.size });
  }

  /**
   * Unregister a migration (completed or paused)
   */
  unregisterActiveMigration(migrationId: string): void {
    this.activeMigrations.delete(migrationId);
    this.shutdownCallbacks.delete(migrationId);
    logger.debug('Unregistered active migration', { migrationId, remaining: this.activeMigrations.size });
  }

  /**
   * Register a shutdown callback for a migration
   * This callback will be called when graceful shutdown is initiated
   */
  registerShutdownCallback(migrationId: string, callback: () => Promise<void>): void {
    this.shutdownCallbacks.set(migrationId, callback);
    logger.debug('Registered shutdown callback', { migrationId });
  }

  /**
   * Check if system is shutting down
   */
  isShutdownRequested(): boolean {
    return this.isShuttingDown;
  }

  /**
   * Initiate graceful shutdown sequence
   */
  async initiateShutdown(signal?: string): Promise<void> {
    if (this.isShuttingDown) {
      logger.warn('Shutdown already in progress');
      return;
    }

    this.isShuttingDown = true;
    logger.info('Initiating graceful shutdown', {
      signal,
      activeMigrations: this.activeMigrations.size,
    });

    // Step 1: Call all registered shutdown callbacks
    const shutdownPromises: Promise<void>[] = [];
    for (const [migrationId, callback] of this.shutdownCallbacks.entries()) {
      logger.info('Calling shutdown callback', { migrationId });
      shutdownPromises.push(
        callback().catch((error) => {
          logger.error('Shutdown callback failed', { migrationId, error });
        })
      );
    }

    // Wait for all migrations to complete their current batch
    await Promise.all(shutdownPromises);

    // Step 2: Flush all log buffers
    logger.info('Flushing log buffers');
    await shutdownAllLoggers();

    // Step 3: Final state save
    logger.info('Graceful shutdown complete');

    // Exit process if signal-triggered (not UI-triggered)
    if (signal) {
      process.exit(0);
    }
  }

  /**
   * Register process signal handlers
   */
  registerSignalHandlers(): void {
    if (this.signalHandlersRegistered) {
      return;
    }

    // Handle SIGTERM (docker stop, kubernetes termination)
    process.on('SIGTERM', async () => {
      logger.info('Received SIGTERM signal');
      await this.initiateShutdown('SIGTERM');
    });

    // Handle SIGINT (Ctrl+C)
    process.on('SIGINT', async () => {
      logger.info('Received SIGINT signal');
      await this.initiateShutdown('SIGINT');
    });

    // Handle SIGUSR2 (nodemon restart)
    process.on('SIGUSR2', async () => {
      logger.info('Received SIGUSR2 signal');
      await this.initiateShutdown('SIGUSR2');
    });

    // Handle uncaught exceptions
    process.on('uncaughtException', async (error) => {
      logger.error('Uncaught exception', { error: error.message, stack: error.stack });
      await this.initiateShutdown('uncaughtException');
      process.exit(1);
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', async (reason) => {
      logger.error('Unhandled promise rejection', { reason });
      await this.initiateShutdown('unhandledRejection');
      process.exit(1);
    });

    this.signalHandlersRegistered = true;
    logger.info('Signal handlers registered');
  }

  /**
   * Get active migration count
   */
  getActiveMigrationCount(): number {
    return this.activeMigrations.size;
  }

  /**
   * Get list of active migration IDs
   */
  getActiveMigrationIds(): string[] {
    return Array.from(this.activeMigrations);
  }
}

// Global shutdown coordinator
const shutdownCoordinator = new ShutdownCoordinator();

/**
 * Register signal handlers for graceful shutdown
 * Call this once at application startup
 */
export function registerShutdownHandlers(): void {
  shutdownCoordinator.registerSignalHandlers();
}

/**
 * Register a migration as active
 */
export function registerActiveMigration(migrationId: string): void {
  shutdownCoordinator.registerActiveMigration(migrationId);
}

/**
 * Unregister a migration (completed or paused)
 */
export function unregisterActiveMigration(migrationId: string): void {
  shutdownCoordinator.unregisterActiveMigration(migrationId);
  pauseRegistry.clearPauseRequest(migrationId);
}

/**
 * Register a callback to be called during graceful shutdown
 * The callback should:
 * 1. Stop accepting new batches
 * 2. Complete current batch
 * 3. Save checkpoint with accurate counts
 * 4. Mark migration as 'paused'
 */
export function registerShutdownCallback(
  migrationId: string,
  callback: () => Promise<void>
): void {
  shutdownCoordinator.registerShutdownCallback(migrationId, callback);
}

/**
 * Check if system-wide shutdown is in progress
 */
export function isShutdownRequested(): boolean {
  return shutdownCoordinator.isShutdownRequested();
}

/**
 * Request a migration to pause gracefully (UI-triggered)
 */
export function requestMigrationPause(migrationId: string): void {
  pauseRegistry.requestPause(migrationId);
}

/**
 * Check if pause was requested for a specific migration
 */
export function isPauseRequested(migrationId: string): boolean {
  return pauseRegistry.isPauseRequested(migrationId) || isShutdownRequested();
}

/**
 * Clear pause request after migration paused
 */
export function clearPauseRequest(migrationId: string): void {
  pauseRegistry.clearPauseRequest(migrationId);
}

/**
 * Get all active migrations
 */
export function getActiveMigrations(): string[] {
  return shutdownCoordinator.getActiveMigrationIds();
}

/**
 * Manually trigger graceful shutdown (for testing or admin use)
 */
export async function triggerGracefulShutdown(): Promise<void> {
  await shutdownCoordinator.initiateShutdown('manual');
}

/**
 * Pause a specific migration gracefully
 * Returns a promise that resolves when the migration is paused
 */
export async function pauseMigration(migrationId: string): Promise<void> {
  logger.info('Pause request initiated', { migrationId });

  // Get initial job state
  const job = await migrationStateStore.getMigrationJob(migrationId);

  // Handle corrupted/missing job file gracefully
  if (!job) {
    logger.error('Cannot pause migration: job file not found or corrupted', {
      migrationId,
      message: 'The migration job file may be corrupted or missing. This can happen with very large migrations.',
    });
    throw new Error(
      `Migration not found: ${migrationId}. The job file may be corrupted. ` +
      `Check data/migrations/${migrationId}.json for issues.`
    );
  }

  // If job is already paused/cancelled/completed, return immediately
  if (job.status === 'paused' || job.status === 'cancelled') {
    logger.info('Migration already in stopped state', { migrationId, status: job.status });
    clearPauseRequest(migrationId);
    return;
  }

  if (job.status === 'completed' || job.status === 'failed') {
    logger.info('Migration already in terminal state', { migrationId, status: job.status });
    clearPauseRequest(migrationId);
    return;
  }

  // Check if job is actually running (heartbeat-based)
  const isRunning = await isJobActive(migrationId);

  if (!isRunning) {
    // Job is in 'in_progress' state but not actually running (stale/orphaned)
    logger.warn('Job is not actually running (no recent heartbeat), force-marking as paused', {
      migrationId,
      status: job.status,
      lastHeartbeat: job.lastHeartbeat,
    });

    // Force-mark as cancelled since it wasn't actually running
    await migrationStateStore.updateJobStatus(migrationId, 'cancelled', new Date());
    await migrationStateStore.addMigrationError(
      migrationId,
      'pause_operation',
      'Job was in "' + job.status + '" status but was not actually running (no recent heartbeat). ' +
        'Marked as cancelled during pause request.',
      'STALE_JOB_FORCE_CANCELLED'
    );

    clearPauseRequest(migrationId);
    logger.info('Orphaned job force-cancelled successfully', { migrationId });
    return;
  }

  // Job is actually running - request graceful pause
  requestMigrationPause(migrationId);
  logger.info('Waiting for active migration to pause gracefully', { migrationId });

  // Wait for migration to reach 'paused' state (with timeout)
  const timeout = 60000; // 60 seconds (reduced from 5 minutes)
  const startTime = Date.now();
  let checkCount = 0;

  while (Date.now() - startTime < timeout) {
    const currentJob = await migrationStateStore.getMigrationJob(migrationId);

    // Handle job file corruption during pause
    if (!currentJob) {
      logger.error('Job file became corrupted during pause operation', { migrationId });
      throw new Error(
        `Migration job file became corrupted during pause: ${migrationId}. ` +
        `The job may have been processing a very large batch. Check data/migrations/ for backup files.`
      );
    }

    if (currentJob.status === 'paused' || currentJob.status === 'cancelled') {
      logger.info('Migration stopped successfully', { migrationId, status: currentJob.status });
      clearPauseRequest(migrationId);
      return;
    }

    if (currentJob.status === 'completed' || currentJob.status === 'failed') {
      logger.info('Migration completed during pause', { migrationId, status: currentJob.status });
      clearPauseRequest(migrationId);
      return;
    }

    // Log progress every 10 seconds
    checkCount++;
    if (checkCount % 10 === 0) {
      logger.info('Still waiting for migration to pause', {
        migrationId,
        status: currentJob.status,
        elapsedSeconds: Math.round((Date.now() - startTime) / 1000),
        timeoutSeconds: Math.round(timeout / 1000),
      });
    }

    // Wait 1 second before checking again
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  // Timeout reached - log detailed error
  const finalJob = await migrationStateStore.getMigrationJob(migrationId);
  logger.error('Timeout waiting for migration to pause', {
    migrationId,
    currentStatus: finalJob?.status,
    lastHeartbeat: finalJob?.lastHeartbeat,
    timeoutSeconds: timeout / 1000,
    message: 'The migration did not respond to the pause request within the timeout period.',
  });

  throw new Error(
    `Timeout waiting for migration ${migrationId} to stop after ${timeout / 1000} seconds. ` +
    `Current status: ${finalJob?.status}. The migration may be processing a large batch. ` +
    `You can try again or use the admin API to force-cancel the job.`
  );
}
