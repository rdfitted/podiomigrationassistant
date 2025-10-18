/**
 * Migration tools test suite
 * Tests for all 5 migration tools with mocked Podio API
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSpace, cloneApp, cloneFlow, cloneHook, updateAppReferences } from '@/lib/ai/tools';

// Mock resource modules
vi.mock('@/lib/podio/resources/spaces', () => ({
  createSpace: vi.fn(async (client, orgId, config) => ({
    space_id: 20,
    name: config.name,
    url: config.name.toLowerCase().replace(/\s+/g, '-'),
    org_id: orgId,
  })),
}));

vi.mock('@/lib/podio/migration', () => ({
  cloneApplication: vi.fn(async (sourceAppId, targetSpaceId) => ({
    source_app_id: sourceAppId,
    target_app_id: 200,
    target_space_id: targetSpaceId,
    cloned_fields: 5,
    field_mapping: {
      'title': 'title',
      'due-date': 'due-date',
    },
  })),
  cloneFlowToApp: vi.fn(async (sourceFlowId, targetAppId) => ({
    source_flow_id: sourceFlowId,
    target_flow_id: '700',
    target_app_id: targetAppId,
    remapped_fields: 3,
  })),
  cloneHookToApp: vi.fn(async (sourceHookId, targetAppId) => ({
    source_hook_id: sourceHookId,
    target_hook_id: 800,
    target_app_id: targetAppId,
  })),
  updateApplicationReferences: vi.fn(async (appId, referenceMappings) => ({
    updated_fields: referenceMappings.length,
    unresolved_references: [],
  })),
}));

describe('Migration Tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createSpace', () => {
    it('should create a new space in an organization', async () => {
      const result = await createSpace.execute({
        orgId: 1,
        name: 'New Workspace',
        privacy: 'closed',
      });

      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({
        space_id: 20,
        name: 'New Workspace',
        org_id: 1,
      });
    });

    it('should validate space name', async () => {
      const result = await createSpace.execute({
        orgId: 1,
        name: '',
        privacy: 'closed',
      });

      expect(result.success).toBe(false);
    });

    it('should handle API errors', async () => {
      const { createSpace: createSpaceFn } = await import('@/lib/podio/resources/spaces');
      vi.mocked(createSpaceFn).mockRejectedValueOnce(new Error('Permission denied'));

      const result = await createSpace.execute({
        orgId: 1,
        name: 'Test',
        privacy: 'closed',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Permission denied');
    });
  });

  describe('cloneApp', () => {
    it('should clone an app to target space', async () => {
      const result = await cloneApp.execute({
        sourceAppId: 100,
        targetSpaceId: 20,
      });

      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({
        source_app_id: 100,
        target_app_id: 200,
        target_space_id: 20,
      });
    });

    it('should return field mapping', async () => {
      const result = await cloneApp.execute({
        sourceAppId: 100,
        targetSpaceId: 20,
      });

      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('field_mapping');
      expect(result.data.cloned_fields).toBeGreaterThan(0);
    });

    it('should handle cloning failures', async () => {
      const { cloneApplication } = await import('@/lib/podio/migration');
      vi.mocked(cloneApplication).mockRejectedValueOnce(new Error('App not found'));

      const result = await cloneApp.execute({
        sourceAppId: 999,
        targetSpaceId: 20,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('App not found');
    });
  });

  describe('cloneFlow', () => {
    it('should clone a flow to target app', async () => {
      const result = await cloneFlow.execute({
        sourceFlowId: '500',
        targetAppId: 200,
      });

      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({
        source_flow_id: '500',
        target_flow_id: '700',
        target_app_id: 200,
      });
    });

    it('should remap field references', async () => {
      const result = await cloneFlow.execute({
        sourceFlowId: '500',
        targetAppId: 200,
      });

      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('remapped_fields');
    });

    it('should handle flow cloning errors', async () => {
      const { cloneFlowToApp } = await import('@/lib/podio/migration');
      vi.mocked(cloneFlowToApp).mockRejectedValueOnce(new Error('Flow not found'));

      const result = await cloneFlow.execute({
        sourceFlowId: '999',
        targetAppId: 200,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Flow not found');
    });
  });

  describe('cloneHook', () => {
    it('should clone a webhook to target app', async () => {
      const result = await cloneHook.execute({
        sourceHookId: 600,
        targetAppId: 200,
      });

      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({
        source_hook_id: 600,
        target_hook_id: 800,
        target_app_id: 200,
      });
    });

    it('should handle hook cloning errors', async () => {
      const { cloneHookToApp } = await import('@/lib/podio/migration');
      vi.mocked(cloneHookToApp).mockRejectedValueOnce(new Error('Hook not found'));

      const result = await cloneHook.execute({
        sourceHookId: 999,
        targetAppId: 200,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Hook not found');
    });
  });

  describe('updateAppReferences', () => {
    it('should update app reference fields', async () => {
      const result = await updateAppReferences.execute({
        appId: 200,
        referenceMappings: [
          {
            field_id: 1005,
            old_app_ids: [100],
            new_app_ids: [200],
          },
        ],
      });

      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({
        updated_fields: 1,
        unresolved_references: [],
      });
    });

    it('should report unresolved references', async () => {
      const { updateApplicationReferences } = await import('@/lib/podio/migration');
      vi.mocked(updateApplicationReferences).mockResolvedValueOnce({
        updated_fields: 0,
        unresolved_references: [
          {
            field_id: 1005,
            field_label: 'Related Items',
            reason: 'Field not found',
          },
        ],
      });

      const result = await updateAppReferences.execute({
        appId: 200,
        referenceMappings: [
          {
            field_id: 1005,
            old_app_ids: [100],
            new_app_ids: [200],
          },
        ],
      });

      expect(result.success).toBe(true);
      expect(result.data.unresolved_references).toHaveLength(1);
    });

    it('should handle update failures', async () => {
      const { updateApplicationReferences } = await import('@/lib/podio/migration');
      vi.mocked(updateApplicationReferences).mockRejectedValueOnce(new Error('Update failed'));

      const result = await updateAppReferences.execute({
        appId: 200,
        referenceMappings: [],
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Update failed');
    });
  });
});

/**
 * Integration test notes:
 * - These tests use mocked migration functions
 * - For real API testing, use a Podio sandbox workspace
 * - Test migrations should be cleaned up after each test
 * - Run integration tests with: npm test -- --run integration
 */
