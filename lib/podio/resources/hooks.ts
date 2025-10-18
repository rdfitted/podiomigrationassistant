/**
 * Hook (Webhook) resource helpers
 * Reference: aidocs/Podio API/08-hooks.md
 * Endpoint: https://api.podio.com/hook/
 */

import { getPodioHttpClient } from '../http/client';
import { Hook, HookValidationRequest } from '../types';

/**
 * Get all hooks for an application
 * GET /hook/app/{app_id}/
 *
 * @param appId - Application ID
 * @returns {Promise<Hook[]>} List of hooks
 */
export async function getHooks(appId: number): Promise<Hook[]> {
  const client = getPodioHttpClient();
  return client.get<Hook[]>(`/hook/app/${appId}/`);
}

/**
 * Get a specific hook by ID
 * GET /hook/{hook_id}
 *
 * @param hookId - Hook ID
 * @returns {Promise<Hook>} Hook details
 */
export async function getHook(hookId: number): Promise<Hook> {
  const client = getPodioHttpClient();
  return client.get<Hook>(`/hook/${hookId}`);
}

/**
 * Create a new webhook for an application
 * POST /hook/app/{app_id}/
 *
 * @param appId - Application ID
 * @param hookData - Hook configuration
 * @returns {Promise<{ hook_id: number }>} Created hook ID
 */
export async function createHook(
  appId: number,
  hookData: {
    url: string;
    type: string; // e.g., 'item.create', 'item.update', 'item.delete'
  }
): Promise<{ hook_id: number }> {
  const client = getPodioHttpClient();
  return client.post<{ hook_id: number }>(`/hook/app/${appId}/`, hookData);
}

/**
 * Create a new webhook for a space
 * POST /hook/space/{space_id}/
 *
 * @param spaceId - Space ID
 * @param hookData - Hook configuration
 * @returns {Promise<{ hook_id: number }>} Created hook ID
 */
export async function createSpaceHook(
  spaceId: number,
  hookData: {
    url: string;
    type: string;
  }
): Promise<{ hook_id: number }> {
  const client = getPodioHttpClient();
  return client.post<{ hook_id: number }>(`/hook/space/${spaceId}/`, hookData);
}

/**
 * Verify a webhook
 * POST /hook/{hook_id}/verify/validate
 *
 * When you create a webhook, Podio sends a verification request.
 * You must respond with the verification code to activate the hook.
 *
 * @param hookId - Hook ID
 * @param code - Verification code from Podio
 * @returns {Promise<void>}
 */
export async function verifyHook(hookId: number, code: string): Promise<void> {
  const client = getPodioHttpClient();
  return client.post<void>(`/hook/${hookId}/verify/validate`, { code });
}

/**
 * Request webhook verification
 * POST /hook/{hook_id}/verify/request
 *
 * Manually request Podio to send a verification request to the webhook URL
 *
 * @param hookId - Hook ID
 * @returns {Promise<void>}
 */
export async function requestHookVerification(hookId: number): Promise<void> {
  const client = getPodioHttpClient();
  return client.post<void>(`/hook/${hookId}/verify/request`);
}


/**
 * Clone a hook to another application
 *
 * Note: The new hook will require re-verification
 *
 * @param sourceHookId - Source hook ID
 * @param targetAppId - Target application ID
 * @param newUrl - New webhook URL (optional, uses source URL if not provided)
 * @returns {Promise<{ hook_id: number }>} Created hook ID
 */
export async function cloneHook(
  sourceHookId: number,
  targetAppId: number,
  newUrl?: string
): Promise<{ hook_id: number }> {
  // Get source hook
  const sourceHook = await getHook(sourceHookId);

  // Create new hook
  return createHook(targetAppId, {
    url: newUrl || sourceHook.url,
    type: sourceHook.type,
  });
}

/**
 * Validate webhook signature
 *
 * Podio signs webhook requests with a signature in the X-Podio-Signature header.
 * This helper validates the signature to ensure the request came from Podio.
 *
 * Note: This is a placeholder - actual signature validation requires the webhook secret
 * which is not provided by the Podio API. Check Podio documentation for latest guidance.
 *
 * @param body - Request body (raw string)
 * @param signature - X-Podio-Signature header value
 * @param secret - Webhook secret (if available)
 * @returns {boolean} True if signature is valid
 */
export function validateWebhookSignature(
  body: string,
  signature: string,
  secret?: string
): boolean {
  // TODO: Implement actual signature validation when webhook secrets are available
  // This is a placeholder that always returns true

  if (!secret) {
    // No secret available, cannot validate
    return true;
  }

  // Actual implementation would use HMAC-SHA256 or similar
  // const crypto = require('crypto');
  // const expectedSignature = crypto
  //   .createHmac('sha256', secret)
  //   .update(body)
  //   .digest('hex');
  // return signature === expectedSignature;

  return true;
}
