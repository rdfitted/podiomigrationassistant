/**
 * Migration state store test suite
 * Tests for migration job persistence and state management
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import { MigrationStateStore, MigrationJob } from '@/lib/migration/state-store';

const TEST_STORE_PATH = 'data/migrations-test';

describe('MigrationStateStore', () => {
  let stateStore: MigrationStateStore;

  beforeEach(async () => {
    stateStore = new MigrationStateStore(TEST_STORE_PATH);
    await stateStore.initialize();
  });

  afterEach(async () => {
    // Clean up test files
    try {
      const files = await fs.readdir(TEST_STORE_PATH);
      await Promise.all(
        files.map(file => fs.unlink(path.join(TEST_STORE_PATH, file)))
      );
      await fs.rmdir(TEST_STORE_PATH);
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('initialize', () => {
    it('should create storage directory if it does not exist', async () => {
      const stats = await fs.stat(TEST_STORE_PATH);
      expect(stats.isDirectory()).toBe(true);
    });
  });

  describe('createMigrationJob', () => {
    it('should create a new migration job with UUID', async () => {
      const job = await stateStore.createMigrationJob('space-10', 'space-20');

      expect(job).toMatchObject({
        sourceSpaceId: 'space-10',
        targetSpaceId: 'space-20',
        status: 'planning',
        steps: [],
        errors: [],
      });
      expect(job.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(job.startedAt).toBeInstanceOf(Date);
    });

    it('should save job to disk', async () => {
      const job = await stateStore.createMigrationJob('space-10', 'space-20');

      const savedJob = await stateStore.getMigrationJob(job.id);
      expect(savedJob).toMatchObject({
        id: job.id,
        sourceSpaceId: 'space-10',
        targetSpaceId: 'space-20',
      });
    });

    it('should support metadata', async () => {
      const job = await stateStore.createMigrationJob('space-10', 'space-20', {
        appCount: 5,
        flowCount: 10,
      });

      expect(job.metadata).toMatchObject({
        appCount: 5,
        flowCount: 10,
      });
    });
  });

  describe('getMigrationJob', () => {
    it('should retrieve an existing migration job', async () => {
      const created = await stateStore.createMigrationJob('space-10', 'space-20');
      const retrieved = await stateStore.getMigrationJob(created.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe(created.id);
    });

    it('should return null for non-existent job', async () => {
      const job = await stateStore.getMigrationJob('non-existent-id');
      expect(job).toBeNull();
    });

    it('should parse dates correctly', async () => {
      const created = await stateStore.createMigrationJob('space-10', 'space-20');
      const retrieved = await stateStore.getMigrationJob(created.id);

      expect(retrieved?.startedAt).toBeInstanceOf(Date);
    });
  });

  describe('listMigrationJobs', () => {
    it('should return all migration jobs', async () => {
      await stateStore.createMigrationJob('space-10', 'space-20');
      await stateStore.createMigrationJob('space-30', 'space-40');

      const jobs = await stateStore.listMigrationJobs();
      expect(jobs).toHaveLength(2);
    });

    it('should return empty array when no jobs exist', async () => {
      const jobs = await stateStore.listMigrationJobs();
      expect(jobs).toEqual([]);
    });
  });

  describe('updateJobStatus', () => {
    it('should update job status', async () => {
      const job = await stateStore.createMigrationJob('space-10', 'space-20');

      await stateStore.updateJobStatus(job.id, 'in_progress');

      const updated = await stateStore.getMigrationJob(job.id);
      expect(updated?.status).toBe('in_progress');
    });

    it('should set completed date when status is completed', async () => {
      const job = await stateStore.createMigrationJob('space-10', 'space-20');

      const completedAt = new Date();
      await stateStore.updateJobStatus(job.id, 'completed', completedAt);

      const updated = await stateStore.getMigrationJob(job.id);
      expect(updated?.status).toBe('completed');
      expect(updated?.completedAt).toBeInstanceOf(Date);
    });

    it('should throw error for non-existent job', async () => {
      await expect(
        stateStore.updateJobStatus('non-existent', 'completed')
      ).rejects.toThrow('Migration job not found');
    });
  });

  describe('addMigrationStep', () => {
    it('should add a step to a job', async () => {
      const job = await stateStore.createMigrationJob('space-10', 'space-20');

      const stepId = await stateStore.addMigrationStep(job.id, 'clone_app', 'app-100');

      const updated = await stateStore.getMigrationJob(job.id);
      expect(updated?.steps).toHaveLength(1);
      expect(updated?.steps[0]).toMatchObject({
        id: stepId,
        type: 'clone_app',
        sourceId: 'app-100',
        status: 'pending',
      });
    });

    it('should throw error for non-existent job', async () => {
      await expect(
        stateStore.addMigrationStep('non-existent', 'clone_app', 'app-100')
      ).rejects.toThrow('Migration job not found');
    });
  });

  describe('updateMigrationStep', () => {
    it('should update step properties', async () => {
      const job = await stateStore.createMigrationJob('space-10', 'space-20');
      const stepId = await stateStore.addMigrationStep(job.id, 'clone_app', 'app-100');

      await stateStore.updateMigrationStep(job.id, stepId, {
        status: 'completed',
        targetId: 'app-200',
      });

      const updated = await stateStore.getMigrationJob(job.id);
      expect(updated?.steps[0]).toMatchObject({
        status: 'completed',
        targetId: 'app-200',
      });
    });

    it('should throw error for non-existent step', async () => {
      const job = await stateStore.createMigrationJob('space-10', 'space-20');

      await expect(
        stateStore.updateMigrationStep(job.id, 'non-existent-step', { status: 'completed' })
      ).rejects.toThrow('Migration step not found');
    });
  });

  describe('addMigrationError', () => {
    it('should add error to job', async () => {
      const job = await stateStore.createMigrationJob('space-10', 'space-20');

      await stateStore.addMigrationError(job.id, 'clone_app', 'App not found', 'NOT_FOUND');

      const updated = await stateStore.getMigrationJob(job.id);
      expect(updated?.errors).toHaveLength(1);
      expect(updated?.errors[0]).toMatchObject({
        step: 'clone_app',
        message: 'App not found',
        code: 'NOT_FOUND',
      });
      expect(updated?.errors[0].timestamp).toBeInstanceOf(Date);
    });
  });

  describe('deleteMigrationJob', () => {
    it('should delete a job', async () => {
      const job = await stateStore.createMigrationJob('space-10', 'space-20');

      await stateStore.deleteMigrationJob(job.id);

      const retrieved = await stateStore.getMigrationJob(job.id);
      expect(retrieved).toBeNull();
    });

    it('should not throw error for non-existent job', async () => {
      await expect(
        stateStore.deleteMigrationJob('non-existent')
      ).resolves.not.toThrow();
    });
  });

  describe('atomic writes', () => {
    it('should use temporary files for atomic writes', async () => {
      const job = await stateStore.createMigrationJob('space-10', 'space-20');

      // Verify no temp files left behind
      const files = await fs.readdir(TEST_STORE_PATH);
      const tempFiles = files.filter(f => f.endsWith('.tmp'));
      expect(tempFiles).toHaveLength(0);
    });
  });

  describe('error handling', () => {
    it('should handle corrupt JSON files gracefully', async () => {
      const job = await stateStore.createMigrationJob('space-10', 'space-20');
      const jobPath = path.join(TEST_STORE_PATH, `${job.id}.json`);

      // Write corrupt JSON
      await fs.writeFile(jobPath, '{invalid json}', 'utf-8');

      await expect(
        stateStore.getMigrationJob(job.id)
      ).rejects.toThrow();
    });
  });
});

/**
 * Integration test notes:
 * - Uses a separate test directory to avoid conflicts
 * - Cleans up after each test
 * - Tests file system operations directly
 */
