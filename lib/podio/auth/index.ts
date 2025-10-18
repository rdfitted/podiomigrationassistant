import { PodioConfig, loadPodioConfig } from '../config';
import { PodioAuthError } from '../errors';
import { obtainPasswordToken, refreshAccessToken } from './password-flow';
import {
  TokenStore,
  FileTokenStore,
  createTokenMetadata,
  shouldRefreshToken,
} from './token-store';
import { StoredTokenData } from './types';
import { podioLog } from '../logging';

/**
 * PodioAuthManager manages OAuth token lifecycle
 *
 * Features:
 * - Automatic token refresh (5-minute pre-expiry window)
 * - Token persistence to avoid repeated password grants
 * - Concurrency-safe token refresh (prevents parallel refresh requests)
 * - Server-side only (do not use in client components)
 */
export class PodioAuthManager {
  private config: PodioConfig;
  private tokenStore: TokenStore;
  private refreshLock: Promise<void> | null = null;

  constructor(config?: PodioConfig, tokenStore?: TokenStore) {
    this.config = config || loadPodioConfig();
    this.tokenStore = tokenStore || new FileTokenStore();
  }

  /**
   * Get a valid access token, refreshing if necessary
   *
   * @returns {Promise<string>} Valid access token
   * @throws {PodioAuthError} If unable to obtain token
   */
  async getAccessToken(): Promise<string> {
    // Wait for any ongoing refresh to complete
    if (this.refreshLock) {
      await this.refreshLock;
    }

    // Try to get cached token
    const storedData = await this.tokenStore.getToken();

    if (storedData) {
      // Check if token needs refresh
      if (shouldRefreshToken(storedData.metadata)) {
        podioLog('info', 'Token within refresh window, refreshing proactively');
        return this.refreshTokenWithLock(storedData);
      }

      // Token is still valid
      return storedData.tokens.access_token;
    }

    // No cached token, obtain new one via password grant
    podioLog('info', 'No cached token found, obtaining via password grant');
    return this.obtainNewToken();
  }

  /**
   * Force token refresh (useful for testing or after 401 responses)
   *
   * @returns {Promise<string>} New access token
   * @throws {PodioAuthError} If refresh fails
   */
  async forceRefresh(): Promise<string> {
    const storedData = await this.tokenStore.getToken();

    if (!storedData) {
      podioLog('warn', 'Force refresh requested but no token cached, obtaining new token');
      return this.obtainNewToken();
    }

    return this.refreshTokenWithLock(storedData);
  }

  /**
   * Clear cached tokens (useful for logout or credential changes)
   */
  async clearTokens(): Promise<void> {
    await this.tokenStore.clearToken();
    podioLog('info', 'Tokens cleared from cache');
  }

  /**
   * Obtain new token via password grant and cache it
   */
  private async obtainNewToken(): Promise<string> {
    try {
      const tokens = await obtainPasswordToken(this.config);
      const metadata = createTokenMetadata(tokens);

      await this.tokenStore.setToken({ tokens, metadata });

      return tokens.access_token;
    } catch (error) {
      if (error instanceof PodioAuthError) {
        throw error;
      }
      throw new PodioAuthError(
        `Failed to obtain new token: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Refresh token with concurrency lock to prevent parallel refreshes
   */
  private async refreshTokenWithLock(storedData: StoredTokenData): Promise<string> {
    // If refresh is already in progress, wait for it
    if (this.refreshLock) {
      podioLog('debug', 'Refresh already in progress, waiting...');
      await this.refreshLock;

      // Get the newly refreshed token
      const newData = await this.tokenStore.getToken();
      if (newData) {
        return newData.tokens.access_token;
      }

      // Fallback if something went wrong
      throw new PodioAuthError('Concurrent refresh failed');
    }

    // Create refresh lock
    this.refreshLock = this.performTokenRefresh(storedData.tokens.refresh_token);

    try {
      await this.refreshLock;

      // Get the newly refreshed token
      const newData = await this.tokenStore.getToken();
      if (newData) {
        return newData.tokens.access_token;
      }

      throw new PodioAuthError('Token refresh completed but token not found in cache');
    } finally {
      // Release lock
      this.refreshLock = null;
    }
  }

  /**
   * Perform the actual token refresh operation
   */
  private async performTokenRefresh(refreshToken: string): Promise<void> {
    try {
      const tokens = await refreshAccessToken(this.config, refreshToken);
      const metadata = createTokenMetadata(tokens);

      await this.tokenStore.setToken({ tokens, metadata });

      podioLog('info', 'Token refreshed successfully');
    } catch (error) {
      podioLog('error', 'Token refresh failed, clearing cache', {
        error: error instanceof Error ? error.message : String(error),
      });

      // Clear invalid tokens
      await this.tokenStore.clearToken();

      throw error;
    }
  }
}

/**
 * Singleton instance for the application
 * Server-side only - do not use in client components
 */
let authManagerInstance: PodioAuthManager | null = null;
let initializationLock: Promise<PodioAuthManager> | null = null;

/**
 * Get the singleton PodioAuthManager instance
 *
 * Concurrency-safe: Multiple concurrent calls will wait for the same initialization
 * to complete, preventing race conditions that could create multiple instances.
 *
 * @returns {Promise<PodioAuthManager>} Singleton auth manager
 */
export async function getPodioAuthManager(): Promise<PodioAuthManager> {
  // If instance already created, return immediately
  if (authManagerInstance) {
    return authManagerInstance;
  }

  // If initialization is in progress, wait for it
  if (initializationLock) {
    podioLog('debug', 'Auth manager initialization in progress, waiting...');
    return initializationLock;
  }

  // Start initialization (first caller wins)
  initializationLock = (async () => {
    podioLog('info', 'Initializing PodioAuthManager singleton');
    authManagerInstance = new PodioAuthManager();
    return authManagerInstance;
  })();

  try {
    const instance = await initializationLock;
    return instance;
  } finally {
    // Clear initialization lock after completion
    initializationLock = null;
  }
}

/**
 * Reset the singleton instance (useful for testing)
 */
export function resetPodioAuthManager(): void {
  authManagerInstance = null;
  initializationLock = null;
}
