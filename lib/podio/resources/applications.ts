/**
 * Application resource helpers
 * Reference: aidocs/Podio API/05-applications.md
 * Endpoint: https://api.podio.com/app/
 */

import { getPodioHttpClient } from '../http/client';
import { Application, AppField } from '../types';

/**
 * Get all applications in a space
 * GET /app/space/{space_id}/
 *
 * @param spaceId - Space ID
 * @returns {Promise<Application[]>} List of applications
 */
export async function getApplications(spaceId: number): Promise<Application[]> {
  const client = getPodioHttpClient();
  return client.get<Application[]>(`/app/space/${spaceId}/`);
}

/**
 * Get a specific application by ID
 * GET /app/{app_id}
 *
 * @param appId - Application ID
 * @returns {Promise<Application>} Application details with fields
 */
export async function getApplication(appId: number): Promise<Application> {
  const client = getPodioHttpClient();
  return client.get<Application>(`/app/${appId}`);
}

/**
 * Get application by URL label
 * GET /app/url?url={url}
 *
 * @param url - Application URL label
 * @returns {Promise<Application>} Application details
 */
export async function getApplicationByUrl(url: string): Promise<Application> {
  const client = getPodioHttpClient();
  return client.get<Application>(`/app/url?url=${encodeURIComponent(url)}`);
}

/**
 * Create a new application in a space
 * POST /app/space/{space_id}/
 *
 * @param spaceId - Space ID
 * @param appData - Application configuration
 * @returns {Promise<{ app_id: number }>} Created application ID
 */
export async function createApplication(
  spaceId: number,
  appData: {
    config: {
      name: string;
      item_name?: string;
      description?: string;
      icon?: string;
      external_id?: string;
      allow_edit?: boolean;
      allow_create?: boolean;
    };
    fields?: Array<{
      type: string;
      config: {
        label: string;
        description?: string;
        required?: boolean;
        unique?: boolean;
        settings?: Record<string, unknown>;
      };
    }>;
  }
): Promise<{ app_id: number }> {
  const client = getPodioHttpClient();
  return client.post<{ app_id: number }>(`/app/space/${spaceId}/`, appData);
}

/**
 * Update application configuration
 * PUT /app/{app_id}
 *
 * @param appId - Application ID
 * @param updates - Application configuration updates
 * @returns {Promise<void>}
 */
export async function updateApplication(
  appId: number,
  updates: {
    config?: {
      name?: string;
      item_name?: string;
      description?: string;
      icon?: string;
      allow_edit?: boolean;
      allow_create?: boolean;
    };
  }
): Promise<void> {
  const client = getPodioHttpClient();
  return client.put<void>(`/app/${appId}`, updates);
}


/**
 * Add a field to an application
 * POST /app/{app_id}/field/
 *
 * @param appId - Application ID
 * @param fieldData - Field configuration
 * @returns {Promise<{ field_id: number }>} Created field ID
 */
export async function addApplicationField(
  appId: number,
  fieldData: {
    type: string;
    config: {
      label: string;
      description?: string;
      required?: boolean;
      unique?: boolean;
      settings?: Record<string, unknown>;
    };
  }
): Promise<{ field_id: number }> {
  const client = getPodioHttpClient();
  return client.post<{ field_id: number }>(`/app/${appId}/field/`, fieldData);
}

/**
 * Update a field in an application
 * PUT /app/{app_id}/field/{field_id}
 *
 * @param appId - Application ID
 * @param fieldId - Field ID
 * @param updates - Field configuration updates
 * @returns {Promise<void>}
 */
export async function updateApplicationField(
  appId: number,
  fieldId: number,
  updates: {
    config?: {
      label?: string;
      description?: string;
      required?: boolean;
      unique?: boolean;
      settings?: Record<string, unknown>;
    };
  }
): Promise<void> {
  const client = getPodioHttpClient();
  return client.put<void>(`/app/${appId}/field/${fieldId}`, updates);
}


/**
 * Get application fields
 * GET /app/{app_id}/field/
 *
 * @param appId - Application ID
 * @returns {Promise<AppField[]>} List of application fields
 */
export async function getApplicationFields(appId: number): Promise<AppField[]> {
  const client = getPodioHttpClient();
  return client.get<AppField[]>(`/app/${appId}/field/`);
}
