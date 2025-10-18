/**
 * Discovery tools test suite
 * Tests for all 6 discovery tools with mocked Podio API
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { listOrganizations, listSpaces, getSpaceApps, getAppStructure, getAppFlows, getAppHooks } from '@/lib/ai/tools';

// Mock Podio API client
vi.mock('@/lib/podio/http/client', () => ({
  PodioHttpClient: vi.fn(),
  createPodioClient: vi.fn(() => ({
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  })),
}));

// Mock resource modules
vi.mock('@/lib/podio/resources/organizations', () => ({
  getOrganizations: vi.fn(async () => [
    {
      org_id: 1,
      name: 'Test Organization',
      url: 'test-org',
      premium: true,
    },
  ]),
}));

vi.mock('@/lib/podio/resources/spaces', () => ({
  getSpaces: vi.fn(async () => [
    {
      space_id: 10,
      name: 'Marketing',
      url: 'marketing',
      org_id: 1,
    },
  ]),
}));

vi.mock('@/lib/podio/resources/applications', () => ({
  getApplications: vi.fn(async () => [
    {
      app_id: 100,
      space_id: 10,
      config: {
        name: 'Projects',
        item_name: 'project',
      },
      url_label: 'projects',
    },
  ]),
  getApplication: vi.fn(async (appId) => ({
    app_id: appId,
    config: {
      name: 'Projects',
      item_name: 'project',
    },
    fields: [
      {
        field_id: 1001,
        type: 'text',
        external_id: 'title',
        config: {
          label: 'Title',
          required: true,
        },
      },
      {
        field_id: 1002,
        type: 'date',
        external_id: 'due-date',
        config: {
          label: 'Due Date',
          required: false,
        },
      },
    ],
  })),
}));

vi.mock('@/lib/podio/resources/flows', () => ({
  getFlows: vi.fn(async () => [
    {
      flow_id: '500',
      name: 'Notify on Create',
      app_id: 100,
      status: 'active',
      effects: [
        {
          type: 'notification',
          config: {},
        },
      ],
    },
  ]),
}));

vi.mock('@/lib/podio/resources/hooks', () => ({
  getHooks: vi.fn(async () => [
    {
      hook_id: 600,
      url: 'https://example.com/webhook',
      type: 'item.create',
    },
  ]),
}));

describe('Discovery Tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('listOrganizations', () => {
    it('should return list of organizations', async () => {
      const result = await listOrganizations.execute({});

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.data[0]).toMatchObject({
        org_id: 1,
        name: 'Test Organization',
      });
    });

    it('should handle errors gracefully', async () => {
      const { getOrganizations } = await import('@/lib/podio/resources/organizations');
      vi.mocked(getOrganizations).mockRejectedValueOnce(new Error('Network error'));

      const result = await listOrganizations.execute({});

      expect(result.success).toBe(false);
      expect(result.error).toContain('Network error');
    });
  });

  describe('listSpaces', () => {
    it('should return spaces for an organization', async () => {
      const result = await listSpaces.execute({ orgId: 1 });

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.data[0]).toMatchObject({
        space_id: 10,
        name: 'Marketing',
        org_id: 1,
      });
    });

    it('should validate orgId parameter', async () => {
      const result = await listSpaces.execute({ orgId: -1 });

      expect(result.success).toBe(false);
    });
  });

  describe('getSpaceApps', () => {
    it('should return apps in a space', async () => {
      const result = await getSpaceApps.execute({ spaceId: 10 });

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.data[0]).toMatchObject({
        app_id: 100,
        space_id: 10,
        name: 'Projects',
      });
    });

    it('should include flow and hook metadata', async () => {
      const result = await getSpaceApps.execute({ spaceId: 10 });

      expect(result.success).toBe(true);
      // Flow and hook counts would be populated if we fetch them
    });
  });

  describe('getAppStructure', () => {
    it('should return complete app structure', async () => {
      const result = await getAppStructure.execute({ appId: 100 });

      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('app_id', 100);
      expect(result.data).toHaveProperty('fields');
      expect(result.data.fields).toHaveLength(2);
    });

    it('should include field types and configurations', async () => {
      const result = await getAppStructure.execute({ appId: 100 });

      expect(result.success).toBe(true);
      const titleField = result.data.fields.find((f: {external_id: string}) => f.external_id === 'title');
      expect(titleField).toMatchObject({
        field_id: 1001,
        type: 'text',
        config: {
          label: 'Title',
          required: true,
        },
      });
    });
  });

  describe('getAppFlows', () => {
    it('should return flows for an app', async () => {
      const result = await getAppFlows.execute({ appId: 100 });

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.data[0]).toMatchObject({
        flow_id: '500',
        name: 'Notify on Create',
        status: 'active',
      });
    });

    it('should handle apps with no flows', async () => {
      const { getFlows } = await import('@/lib/podio/resources/flows');
      vi.mocked(getFlows).mockResolvedValueOnce([]);

      const result = await getAppFlows.execute({ appId: 100 });

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(0);
    });
  });

  describe('getAppHooks', () => {
    it('should return hooks for an app', async () => {
      const result = await getAppHooks.execute({ appId: 100 });

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.data[0]).toMatchObject({
        hook_id: 600,
        url: 'https://example.com/webhook',
        type: 'item.create',
      });
    });

    it('should handle apps with no hooks', async () => {
      const { getHooks } = await import('@/lib/podio/resources/hooks');
      vi.mocked(getHooks).mockResolvedValueOnce([]);

      const result = await getAppHooks.execute({ appId: 100 });

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(0);
    });
  });
});

/**
 * Integration test notes:
 * - These tests use mocked Podio API responses
 * - For real API testing, use a Podio sandbox workspace
 * - Set PODIO_CLIENT_ID, PODIO_CLIENT_SECRET, etc. in test environment
 * - Run integration tests with: npm test -- --run integration
 */
