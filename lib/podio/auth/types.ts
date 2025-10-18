/**
 * Auth Types for Podio OAuth 2.0 Password Flow
 * Reference: aidocs/Podio API/02-authentication.md
 */

/**
 * OAuth token response from Podio API
 */
export interface AuthTokens {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
  ref?: {
    type: string;
    id: number;
  };
}

/**
 * Metadata for token management
 */
export interface TokenMetadata {
  /** When the token was obtained (milliseconds since epoch) */
  obtainedAt: number;
  /** When the token expires (milliseconds since epoch) */
  expiresAt: number;
  /** Whether the token is currently being refreshed */
  isRefreshing?: boolean;
}

/**
 * Stored token data with metadata
 */
export interface StoredTokenData {
  tokens: AuthTokens;
  metadata: TokenMetadata;
}

/**
 * OAuth password grant request parameters
 */
export interface PasswordGrantRequest {
  grant_type: 'password';
  client_id: string;
  client_secret: string;
  username: string;
  password: string;
}

/**
 * OAuth refresh token request parameters
 */
export interface RefreshTokenRequest {
  grant_type: 'refresh_token';
  client_id: string;
  client_secret: string;
  refresh_token: string;
}

/**
 * OAuth error response from Podio API
 */
export interface OAuthErrorResponse {
  error: string;
  error_description?: string;
  error_detail?: string;
}
