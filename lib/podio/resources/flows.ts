/**
 * Flow (Globiflow workflow) resource helpers
 * Reference: aidocs/Podio API/07-flows.md
 *
 * Note: Flows are managed by Globiflow (external service integrated with Podio).
 * These helpers provide basic CRUD operations. For migration, you may need to use
 * Globiflow's API directly.
 */

import { getPodioHttpClient } from '../http/client';
import { Flow } from '../types';

/**
 * Get all flows for an application
 * GET /flow/app/{app_id}/
 *
 * @param appId - Application ID
 * @returns {Promise<Flow[]>} List of flows
 */
export async function getFlows(appId: number): Promise<Flow[]> {
  const client = getPodioHttpClient();
  return client.get<Flow[]>(`/flow/app/${appId}/`);
}

/**
 * Get a specific flow by ID
 * GET /flow/{flow_id}
 *
 * @param flowId - Flow ID
 * @returns {Promise<Flow>} Flow details
 */
export async function getFlow(flowId: string): Promise<Flow> {
  const client = getPodioHttpClient();
  return client.get<Flow>(`/flow/${flowId}`);
}

/**
 * Create a new flow for an application
 * POST /flow/app/{app_id}/
 *
 * @param appId - Application ID
 * @param flowData - Flow configuration
 * @returns {Promise<{ flow_id: string }>} Created flow ID
 */
export async function createFlow(
  appId: number,
  flowData: {
    name: string;
    status?: 'active' | 'inactive';
    type?: string;
    trigger?: {
      type: string;
      config: Record<string, unknown>;
    };
    actions?: Array<{
      type: string;
      config: Record<string, unknown>;
    }>;
    conditions?: Array<{
      type: string;
      config: Record<string, unknown>;
    }>;
  }
): Promise<{ flow_id: string }> {
  const client = getPodioHttpClient();
  return client.post<{ flow_id: string }>(`/flow/app/${appId}/`, flowData);
}

/**
 * Update a flow
 * PUT /flow/{flow_id}
 *
 * @param flowId - Flow ID
 * @param updates - Flow updates
 * @returns {Promise<void>}
 */
export async function updateFlow(
  flowId: string,
  updates: {
    name?: string;
    status?: 'active' | 'inactive';
    trigger?: {
      type: string;
      config: Record<string, unknown>;
    };
    actions?: Array<{
      type: string;
      config: Record<string, unknown>;
    }>;
    conditions?: Array<{
      type: string;
      config: Record<string, unknown>;
    }>;
  }
): Promise<void> {
  const client = getPodioHttpClient();
  return client.put<void>(`/flow/${flowId}`, updates);
}


/**
 * Get flow execution history
 * GET /flow/{flow_id}/execution/
 *
 * @param flowId - Flow ID
 * @param params - Query parameters
 * @returns {Promise<unknown[]>} Flow execution history
 */
export async function getFlowExecutions(
  flowId: string,
  params?: {
    limit?: number;
    offset?: number;
  }
): Promise<unknown[]> {
  const client = getPodioHttpClient();
  const queryParams = new URLSearchParams();
  if (params?.limit) queryParams.set('limit', params.limit.toString());
  if (params?.offset) queryParams.set('offset', params.offset.toString());

  const query = queryParams.toString();
  const endpoint = `/flow/${flowId}/execution/${query ? `?${query}` : ''}`;

  return client.get<unknown[]>(endpoint);
}

/**
 * Clone a flow to another application
 *
 * Note: This is a helper that creates a new flow based on an existing one.
 * You'll need to adjust field references and app-specific configurations.
 *
 * @param sourceFlowId - Source flow ID
 * @param targetAppId - Target application ID
 * @param options - Clone options
 * @returns {Promise<{ flow_id: string }>} Created flow ID
 */
export async function cloneFlow(
  sourceFlowId: string,
  targetAppId: number,
  options?: {
    newName?: string;
    status?: 'active' | 'inactive';
    fieldMapping?: Record<number, number>; // Map source field IDs to target field IDs
  }
): Promise<{ flow_id: string }> {
  // Get source flow
  const sourceFlow = await getFlow(sourceFlowId);

  // Prepare new flow data
  const newFlowData = {
    name: options?.newName || `${sourceFlow.name} (Copy)`,
    status: options?.status || 'inactive', // Start inactive by default
    type: sourceFlow.type,
    trigger: sourceFlow.trigger,
    actions: sourceFlow.actions,
    conditions: sourceFlow.conditions,
  };

  // TODO: Apply field mapping to trigger, actions, and conditions
  // This requires parsing and updating field references based on the mapping

  // Create new flow
  return createFlow(targetAppId, newFlowData);
}
