/**
 * Space resource helpers
 * Reference: aidocs/Podio API/04-spaces.md
 * Endpoint: https://api.podio.com/space/
 */

import { getPodioHttpClient } from '../http/client';
import { Space } from '../types';

/**
 * Get all spaces in an organization
 * GET /space/org/{org_id}/
 *
 * @param orgId - Organization ID
 * @returns {Promise<Space[]>} List of spaces
 */
export async function getSpaces(orgId: number): Promise<Space[]> {
  const client = getPodioHttpClient();
  return client.get<Space[]>(`/space/org/${orgId}/`);
}

/**
 * Get a specific space by ID
 * GET /space/{space_id}
 *
 * @param spaceId - Space ID
 * @returns {Promise<Space>} Space details
 */
export async function getSpace(spaceId: number): Promise<Space> {
  const client = getPodioHttpClient();
  return client.get<Space>(`/space/${spaceId}`);
}

/**
 * Get space by URL label
 * GET /space/url?url={url}
 *
 * @param url - Space URL label
 * @returns {Promise<Space>} Space details
 */
export async function getSpaceByUrl(url: string): Promise<Space> {
  const client = getPodioHttpClient();
  return client.get<Space>(`/space/url?url=${encodeURIComponent(url)}`);
}

/**
 * Create a new space in an organization
 * POST /space/org/{org_id}/
 *
 * @param orgId - Organization ID
 * @param spaceData - Space configuration
 * @returns {Promise<{ space_id: number }>} Created space ID
 */
export async function createSpace(
  orgId: number,
  spaceData: {
    name: string;
    privacy?: 'open' | 'closed';
    auto_join?: boolean;
    post_on_new_app?: boolean;
    post_on_new_member?: boolean;
  }
): Promise<{ space_id: number }> {
  const client = getPodioHttpClient();
  return client.post<{ space_id: number }>(`/space/org/${orgId}/`, spaceData);
}

/**
 * Update space settings
 * PUT /space/{space_id}
 *
 * @param spaceId - Space ID
 * @param updates - Space updates
 * @returns {Promise<void>}
 */
export async function updateSpace(
  spaceId: number,
  updates: {
    name?: string;
    privacy?: 'open' | 'closed';
    auto_join?: boolean;
    post_on_new_app?: boolean;
    post_on_new_member?: boolean;
  }
): Promise<void> {
  const client = getPodioHttpClient();
  return client.put<void>(`/space/${spaceId}`, updates);
}

/**
 * Get space members
 * GET /space/{space_id}/member/
 *
 * @param spaceId - Space ID
 * @returns {Promise<unknown[]>} List of space members
 */
export async function getSpaceMembers(spaceId: number): Promise<unknown[]> {
  const client = getPodioHttpClient();
  return client.get<unknown[]>(`/space/${spaceId}/member/`);
}

