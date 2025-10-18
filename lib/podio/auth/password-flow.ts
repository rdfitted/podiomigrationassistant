import { PodioConfig } from '../config';
import { PodioAuthError } from '../errors';
import {
  AuthTokens,
  OAuthErrorResponse,
  PasswordGrantRequest,
  RefreshTokenRequest,
} from './types';
import { podioLog, logTokenRefresh } from '../logging';

/**
 * Obtain access token using OAuth 2.0 password flow
 * Reference: aidocs/Podio API/02-authentication.md
 *
 * @param config - Podio configuration with credentials
 * @returns {Promise<AuthTokens>} OAuth tokens from Podio
 * @throws {PodioAuthError} If authentication fails
 */
export async function obtainPasswordToken(
  config: PodioConfig
): Promise<AuthTokens> {
  const tokenUrl = `${config.apiBase}/oauth/token/v2`;

  // Validate all required fields are present
  const missing: string[] = [];
  if (!config.clientId) missing.push('clientId');
  if (!config.clientSecret) missing.push('clientSecret');
  if (!config.username) missing.push('username');
  if (!config.password) missing.push('password');

  if (missing.length > 0) {
    throw new PodioAuthError(
      `Missing required OAuth fields: ${missing.join(', ')}. Check your .env.local file.`,
      'missing_credentials'
    );
  }

  const requestBody: PasswordGrantRequest = {
    grant_type: 'password',
    client_id: config.clientId,
    client_secret: config.clientSecret,
    username: config.username,
    password: config.password,
  };

  podioLog('info', 'Requesting password grant token', {
    url: tokenUrl,
    clientId: config.clientId ? `${config.clientId.substring(0, 10)}...` : 'MISSING',
    username: config.username || 'MISSING',
    passwordLength: config.password?.length || 0,
    secretLength: config.clientSecret?.length || 0,
  });

  try {
    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const responseText = await response.text();
      podioLog('error', 'OAuth error response', {
        status: response.status,
        statusText: response.statusText,
        body: responseText,
      });

      let errorData: OAuthErrorResponse;
      try {
        errorData = JSON.parse(responseText) as OAuthErrorResponse;
      } catch {
        throw new PodioAuthError(
          `Password grant failed: HTTP ${response.status} - ${responseText}`,
          'invalid_response',
          responseText
        );
      }

      logTokenRefresh(false, errorData.error_description);

      throw new PodioAuthError(
        `Password grant failed: ${errorData.error_description || errorData.error}`,
        errorData.error,
        errorData.error_description
      );
    }

    const responseText = await response.text();
    podioLog('info', 'OAuth success response', {
      body: responseText.substring(0, 100),
    });

    const tokens = JSON.parse(responseText) as AuthTokens;
    logTokenRefresh(true, 'Password grant successful');

    return tokens;
  } catch (error) {
    if (error instanceof PodioAuthError) {
      throw error;
    }

    // Network or other errors
    podioLog('error', 'Password grant network error', {
      error: error instanceof Error ? error.message : String(error),
    });

    throw new PodioAuthError(
      `Failed to obtain password token: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Refresh access token using refresh token
 * Reference: aidocs/Podio API/02-authentication.md
 *
 * Note: Podio issues a new refresh token with each refresh.
 * The old refresh token is invalidated.
 *
 * @param config - Podio configuration
 * @param refreshToken - Current refresh token
 * @returns {Promise<AuthTokens>} New OAuth tokens from Podio
 * @throws {PodioAuthError} If token refresh fails
 */
export async function refreshAccessToken(
  config: PodioConfig,
  refreshToken: string
): Promise<AuthTokens> {
  const tokenUrl = `${config.apiBase}/oauth/token/v2`;

  const requestBody: RefreshTokenRequest = {
    grant_type: 'refresh_token',
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: refreshToken,
  };

  podioLog('info', 'Refreshing access token');

  try {
    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorData = (await response.json()) as OAuthErrorResponse;
      logTokenRefresh(false, errorData.error_description);

      throw new PodioAuthError(
        `Token refresh failed: ${errorData.error_description || errorData.error}`,
        errorData.error,
        errorData.error_description
      );
    }

    const tokens = (await response.json()) as AuthTokens;
    logTokenRefresh(true, 'Token refresh successful');

    return tokens;
  } catch (error) {
    if (error instanceof PodioAuthError) {
      throw error;
    }

    // Network or other errors
    podioLog('error', 'Token refresh network error', {
      error: error instanceof Error ? error.message : String(error),
    });

    throw new PodioAuthError(
      `Failed to refresh token: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
