/**
 * Organization resource helpers
 * Reference: aidocs/Podio API/03-organizations.md
 * Endpoint: https://api.podio.com/org/
 */

import { getPodioHttpClient } from '../http/client';
import { Organization } from '../types';

/**
 * Get all organizations the user is a member of
 * GET /org/
 *
 * @returns {Promise<Organization[]>} List of organizations
 */
export async function getOrganizations(): Promise<Organization[]> {
  const client = getPodioHttpClient();
  const response = await client.get<Organization[] | Record<string, Organization>>('/org/');

  // Podio API returns an object with numeric keys instead of an array
  // Convert to array if needed
  if (!Array.isArray(response)) {
    return Object.values(response);
  }

  return response;
}

/**
 * Get a specific organization by ID
 * GET /org/{org_id}
 *
 * @param orgId - Organization ID
 * @returns {Promise<Organization>} Organization details
 */
export async function getOrganization(orgId: number): Promise<Organization> {
  const client = getPodioHttpClient();
  return client.get<Organization>(`/org/${orgId}`);
}

/**
 * Get organization by URL label
 * GET /org/url?url={url}
 *
 * @param url - Organization URL label
 * @returns {Promise<Organization>} Organization details
 */
export async function getOrganizationByUrl(url: string): Promise<Organization> {
  const client = getPodioHttpClient();
  return client.get<Organization>(`/org/url?url=${encodeURIComponent(url)}`);
}

/**
 * Get organization members
 * GET /org/{org_id}/member/
 *
 * @param orgId - Organization ID
 * @returns {Promise<unknown[]>} List of organization members
 */
export async function getOrganizationMembers(orgId: number): Promise<unknown[]> {
  const client = getPodioHttpClient();
  return client.get<unknown[]>(`/org/${orgId}/member/`);
}

/**
 * Get organization statistics
 * GET /org/{org_id}/statistics
 *
 * @param orgId - Organization ID
 * @returns {Promise<unknown>} Organization statistics
 */
export async function getOrganizationStatistics(orgId: number): Promise<unknown> {
  const client = getPodioHttpClient();
  return client.get<unknown>(`/org/${orgId}/statistics`);
}
