import * as fs from 'fs/promises';
import * as path from 'path';
import { StoredTokenData, AuthTokens, TokenMetadata } from './types';
import { podioLog } from '../logging';

/**
 * Token storage interface for pluggable persistence
 */
export interface TokenStore {
  /**
   * Retrieve stored token data
   */
  getToken(): Promise<StoredTokenData | null>;

  /**
   * Store token data with metadata
   */
  setToken(data: StoredTokenData): Promise<void>;

  /**
   * Clear stored token data
   */
  clearToken(): Promise<void>;
}

/**
 * File-based token store implementation
 * Stores tokens in a JSON file at logs/podio-token-cache.json
 *
 * Note: For production, consider:
 * - Encrypting tokens at rest
 * - Using Redis/KV store for distributed systems
 * - Implementing proper file locking for concurrent access
 */
export class FileTokenStore implements TokenStore {
  private readonly filePath: string;

  constructor(filePath: string = 'logs/podio-token-cache.json') {
    this.filePath = path.resolve(process.cwd(), filePath);
  }

  async getToken(): Promise<StoredTokenData | null> {
    try {
      const data = await fs.readFile(this.filePath, 'utf-8');
      const parsed = JSON.parse(data) as StoredTokenData;

      // Return token even if expired - let auth manager decide whether to refresh or obtain new
      // The auth manager will use the refresh token if available
      if (parsed.metadata.expiresAt < Date.now()) {
        podioLog('info', 'Stored token is expired, but returning for potential refresh');
      }

      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        // File doesn't exist yet
        return null;
      }
      podioLog('error', 'Failed to read token cache', { error });
      return null;
    }
  }

  async setToken(data: StoredTokenData): Promise<void> {
    try {
      // Ensure logs directory exists
      const dir = path.dirname(this.filePath);
      await fs.mkdir(dir, { recursive: true });

      // Write atomically by writing to temp file then renaming
      const tempPath = `${this.filePath}.tmp`;
      await fs.writeFile(tempPath, JSON.stringify(data, null, 2), 'utf-8');
      await fs.rename(tempPath, this.filePath);

      podioLog('info', 'Token cache updated', {
        expiresAt: new Date(data.metadata.expiresAt).toISOString(),
      });
    } catch (error) {
      podioLog('error', 'Failed to write token cache', { error });
      throw error;
    }
  }

  async clearToken(): Promise<void> {
    try {
      await fs.unlink(this.filePath);
      podioLog('info', 'Token cache cleared');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        podioLog('error', 'Failed to clear token cache', { error });
      }
    }
  }
}

/**
 * In-memory token store for testing or ephemeral environments
 */
export class MemoryTokenStore implements TokenStore {
  private token: StoredTokenData | null = null;

  async getToken(): Promise<StoredTokenData | null> {
    // Return token even if expired - let auth manager decide whether to refresh
    return this.token;
  }

  async setToken(data: StoredTokenData): Promise<void> {
    this.token = data;
  }

  async clearToken(): Promise<void> {
    this.token = null;
  }
}

/**
 * Create token metadata from OAuth response
 */
export function createTokenMetadata(tokens: AuthTokens): TokenMetadata {
  const obtainedAt = Date.now();
  const expiresAt = obtainedAt + tokens.expires_in * 1000;

  return {
    obtainedAt,
    expiresAt,
  };
}

/**
 * Check if token should be refreshed (within 5 minutes of expiry)
 */
export function shouldRefreshToken(metadata: TokenMetadata): boolean {
  const REFRESH_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
  const now = Date.now();
  return now >= metadata.expiresAt - REFRESH_WINDOW_MS;
}

/**
 * Helper function to save tokens using the default file store
 */
export async function saveTokens(tokens: AuthTokens): Promise<void> {
  podioLog('info', 'saveTokens called', {
    hasAccessToken: !!tokens.access_token,
    hasRefreshToken: !!tokens.refresh_token,
    expiresIn: tokens.expires_in,
  });

  const store = new FileTokenStore();
  const storedData: StoredTokenData = {
    tokens,
    metadata: createTokenMetadata(tokens),
  };

  podioLog('info', 'Saving tokens to file store', {
    filePath: 'logs/podio-token-cache.json',
    expiresAt: new Date(storedData.metadata.expiresAt).toISOString(),
  });

  await store.setToken(storedData);

  podioLog('info', 'Tokens saved successfully');
}
