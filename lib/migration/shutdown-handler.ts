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
  // Request pause
  requestMigrationPause(migrationId);

  logger.info('Waiting for migration to pause', { migrationId });

  // Wait for migration to reach 'paused' state (with timeout)
  const timeout = 300000; // 5 minutes (increased from 60 seconds to handle long-running streaming phases)
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const job = await migrationStateStore.getMigrationJob(migrationId);

    if (!job) {
      throw new Error(`Migration not found: ${migrationId}`);
    }

    if (job.status === 'paused' || job.status === 'cancelled') {
      logger.info('Migration stopped successfully', { migrationId, status: job.status });
      clearPauseRequest(migrationId);
      return;
    }

    if (job.status === 'completed' || job.status === 'failed') {
      logger.warn('Migration completed before stop', { migrationId, status: job.status });
      clearPauseRequest(migrationId);
      return;
    }

    // Wait 1 second before checking again
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  // Timeout reached
  throw new Error(`Timeout waiting for migration ${migrationId} to stop`);
}
