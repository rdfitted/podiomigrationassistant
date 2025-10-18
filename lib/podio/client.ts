/**
 * Client-side fetch utilities for Podio API routes
 * These functions call Next.js API routes that handle server-side authentication
 */

import { Organization, Space, Application } from './types';

/**
 * API response wrapper type
 */
type ApiResponse<T> = {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    statusCode?: number;
  };
};

/**
 * Custom error for API failures
 */
export class PodioClientError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode?: number
  ) {
    super(message);
    this.name = 'PodioClientError';
  }
}

/**
 * Fetch all organizations the authenticated user has access to
 *
 * @returns {Promise<Organization[]>} List of organizations
 * @throws {PodioClientError} If the request fails
 */
export async function fetchOrganizations(): Promise<Organization[]> {
  const response = await fetch('/api/podio/organizations');
  const result: ApiResponse<Organization[]> = await response.json();

  if (!result.success || !result.data) {
    throw new PodioClientError(
      result.error?.code || 'UNKNOWN_ERROR',
      result.error?.message || 'Failed to fetch organizations',
      result.error?.statusCode || response.status
    );
  }

  return result.data;
}

/**
 * Fetch all spaces (workspaces) in a specific organization
 *
 * @param orgId - Organization ID
 * @returns {Promise<Space[]>} List of spaces
 * @throws {PodioClientError} If the request fails
 */
export async function fetchSpaces(orgId: number): Promise<Space[]> {
  const response = await fetch(`/api/podio/organizations/${orgId}/spaces`);
  const result: ApiResponse<Space[]> = await response.json();

  if (!result.success || !result.data) {
    throw new PodioClientError(
      result.error?.code || 'UNKNOWN_ERROR',
      result.error?.message || 'Failed to fetch spaces',
      result.error?.statusCode || response.status
    );
  }

  return result.data;
}

/**
 * Fetch all applications in a specific space (workspace)
 *
 * @param spaceId - Space ID
 * @returns {Promise<Application[]>} List of applications
 * @throws {PodioClientError} If the request fails
 */
export async function fetchApps(spaceId: number): Promise<Application[]> {
  const response = await fetch(`/api/podio/spaces/${spaceId}/apps`);
  const result: ApiResponse<Application[]> = await response.json();

  if (!result.success || !result.data) {
    throw new PodioClientError(
      result.error?.code || 'UNKNOWN_ERROR',
      result.error?.message || 'Failed to fetch applications',
      result.error?.statusCode || response.status
    );
  }

  return result.data;
}
