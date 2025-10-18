/**
 * Authorization Code Flow for Podio OAuth
 * Reference: aidocs/Podio API/02-authentication.md
 */

import { PodioConfig } from '../config';
import { PodioAuthError } from '../errors';
import { AuthTokens, OAuthErrorResponse } from './types';
import { podioLog, logTokenRefresh } from '../logging';

/**
 * Generate authorization URL for user to approve the app
 */
export function getAuthorizationUrl(config: PodioConfig, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: redirectUri,
    state: state,
  });

  return `https://podio.com/oauth/authorize?${params.toString()}`;
}

/**
 * Exchange authorization code for access token
 */
export async function exchangeCodeForToken(
  config: PodioConfig,
  code: string,
  redirectUri: string
): Promise<AuthTokens> {
  const tokenUrl = `${config.apiBase}/oauth/token/v2`;

  const requestBody = {
    grant_type: 'authorization_code',
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: redirectUri,
    code: code,
  };

  podioLog('info', 'Exchanging authorization code for token', {
    url: tokenUrl,
    clientId: config.clientId ? `${config.clientId.substring(0, 10)}...` : 'NULL',
    hasSecret: !!config.clientSecret,
    redirectUri: redirectUri,
    hasCode: !!code,
    codeLength: code?.length || 0,
  });

  try {
    podioLog('info', 'Request body being sent', {
      params: requestBody,
    });

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const responseText = await response.text();
      podioLog('error', 'Token exchange error', {
        status: response.status,
        body: responseText,
      });

      let errorData: OAuthErrorResponse;
      try {
        errorData = JSON.parse(responseText) as OAuthErrorResponse;
      } catch {
        throw new PodioAuthError(
          `Token exchange failed: HTTP ${response.status} - ${responseText}`,
          'invalid_response',
          responseText
        );
      }

      logTokenRefresh(false, errorData.error_description);
      throw new PodioAuthError(
        `Token exchange failed: ${errorData.error_description || errorData.error}`,
        errorData.error,
        errorData.error_description
      );
    }

    const responseText = await response.text();
    const tokens = JSON.parse(responseText) as AuthTokens;
    logTokenRefresh(true, 'Authorization code exchange successful');

    return tokens;
  } catch (error) {
    if (error instanceof PodioAuthError) {
      throw error;
    }

    podioLog('error', 'Token exchange network error', {
      error: error instanceof Error ? error.message : String(error),
    });

    throw new PodioAuthError(
      `Failed to exchange code for token: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
