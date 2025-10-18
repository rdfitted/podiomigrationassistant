import { loadPodioConfig } from '../config';
import { getPodioAuthManager } from '../auth';
import { PodioApiError } from '../errors';
import { RateLimitInfo } from '../types';
import {
  logApiRequest,
  logApiResponse,
  logApiError,
  logRateLimit,
  generateCorrelationId,
} from '../logging';
import { withRetry, RetryConfig } from './retry';
import { getRateLimitTracker } from './rate-limit-tracker';

/**
 * HTTP request options for Podio API client
 */
export interface PodioRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  retryConfig?: RetryConfig;
  skipAuth?: boolean;
}

/**
 * Podio API HTTP Client
 *
 * Features:
 * - Automatic OAuth token injection
 * - Error handling with PodioApiError
 * - Automatic token refresh on 401
 * - Rate limit detection and logging
 * - Retry logic with exponential backoff
 * - Request/response logging
 */
export class PodioHttpClient {
  private readonly apiBase: string;

  constructor(apiBase?: string) {
    this.apiBase = apiBase || loadPodioConfig().apiBase;
  }

  /**
   * Make a request to the Podio API
   *
   * @param endpoint - API endpoint (e.g., '/org/')
   * @param options - Request options
   * @returns Parsed JSON response
   * @throws {PodioApiError} On API errors
   */
  async request<T = unknown>(
    endpoint: string,
    options: PodioRequestOptions = {}
  ): Promise<T> {
    const {
      method = 'GET',
      body,
      headers = {},
      retryConfig,
      skipAuth = false,
    } = options;

    const url = `${this.apiBase}${endpoint}`;
    const correlationId = generateCorrelationId();

    // Wrap the actual request in retry logic
    return withRetry(
      async () => {
        // Get access token if not skipping auth
        let accessToken: string | undefined;
        if (!skipAuth) {
          const authManager = await getPodioAuthManager();
          accessToken = await authManager.getAccessToken();
        }

        // Build request headers
        const requestHeaders: Record<string, string> = {
          'Content-Type': 'application/json',
          ...headers,
        };

        if (accessToken) {
          requestHeaders['Authorization'] = `OAuth2 ${accessToken}`;
        }

        logApiRequest(method, url, correlationId);

        const startTime = Date.now();

        // Make request
        const response = await fetch(url, {
          method,
          headers: requestHeaders,
          body: body ? JSON.stringify(body) : undefined,
        });

        const duration = Date.now() - startTime;

        // Extract and track rate limit info
        const rateLimitInfo = this.extractRateLimitInfo(response);
        if (rateLimitInfo) {
          // Update global rate limit tracker
          const tracker = getRateLimitTracker();
          tracker.updateFromHeaders(
            rateLimitInfo.limit,
            rateLimitInfo.remaining,
            rateLimitInfo.reset
          );

          // Log if remaining is low
          if (rateLimitInfo.remaining < 100) {
            logRateLimit(
              rateLimitInfo.remaining,
              rateLimitInfo.limit,
              rateLimitInfo.reset
            );
          }
        }

        // Handle 401 Unauthorized - attempt token refresh and retry once
        if (response.status === 401 && !skipAuth) {
          logApiResponse(method, url, response.status, correlationId, duration, undefined);

          const authManager = await getPodioAuthManager();
          await authManager.forceRefresh();

          // Retry request with new token
          const newToken = await authManager.getAccessToken();
          requestHeaders['Authorization'] = `OAuth2 ${newToken}`;

          const retryResponse = await fetch(url, {
            method,
            headers: requestHeaders,
            body: body ? JSON.stringify(body) : undefined,
          });

          return this.handleResponse<T>(
            retryResponse,
            method,
            url,
            correlationId,
            duration
          );
        }

        return this.handleResponse<T>(
          response,
          method,
          url,
          correlationId,
          duration
        );
      },
      retryConfig,
      { method, url }
    );
  }

  /**
   * Handle response, parsing JSON or throwing errors
   */
  private async handleResponse<T>(
    response: Response,
    method: string,
    url: string,
    correlationId: string,
    duration: number
  ): Promise<T> {
    // Success responses
    if (response.ok) {
      // Handle 204 No Content
      if (response.status === 204) {
        logApiResponse(method, url, response.status, correlationId, duration, undefined);
        return undefined as T;
      }

      const responseBody = (await response.json()) as T;
      logApiResponse(method, url, response.status, correlationId, duration, responseBody);
      return responseBody;
    }

    // Error responses
    // Read body as text first (can only read once), then try to parse as JSON
    const errorText = await response.text();
    let errorBody: unknown;
    try {
      errorBody = JSON.parse(errorText);
    } catch {
      errorBody = errorText;
    }

    const errorData = errorBody as {
      error?: string;
      error_description?: string;
      error_detail?: string;
    };

    const error = new PodioApiError(
      errorData.error_description ||
        errorData.error ||
        `Podio API error: ${response.status}`,
      response.status,
      errorData.error,
      errorData.error_detail,
      { headers: Object.fromEntries(response.headers.entries()), body: errorBody }
    );

    logApiError(method, url, error, correlationId);

    throw error;
  }

  /**
   * Extract rate limit information from response headers
   */
  private extractRateLimitInfo(response: Response): RateLimitInfo | null {
    const limit = response.headers.get('x-rate-limit-limit');
    const remaining = response.headers.get('x-rate-limit-remaining');
    const reset = response.headers.get('x-rate-limit-reset');

    if (limit && remaining && reset) {
      return {
        limit: parseInt(limit, 10),
        remaining: parseInt(remaining, 10),
        reset,
      };
    }

    return null;
  }

  /**
   * Convenience method for GET requests
   */
  async get<T = unknown>(
    endpoint: string,
    options?: Omit<PodioRequestOptions, 'method' | 'body'>
  ): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: 'GET' });
  }

  /**
   * Convenience method for POST requests
   */
  async post<T = unknown>(
    endpoint: string,
    body?: unknown,
    options?: Omit<PodioRequestOptions, 'method' | 'body'>
  ): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: 'POST', body });
  }

  /**
   * Convenience method for PUT requests
   */
  async put<T = unknown>(
    endpoint: string,
    body?: unknown,
    options?: Omit<PodioRequestOptions, 'method' | 'body'>
  ): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: 'PUT', body });
  }

  /**
   * Convenience method for DELETE requests
   */
  async delete<T = unknown>(
    endpoint: string,
    options?: Omit<PodioRequestOptions, 'method' | 'body'>
  ): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: 'DELETE' });
  }
}

/**
 * Singleton HTTP client instance
 */
let httpClientInstance: PodioHttpClient | null = null;

/**
 * Get the singleton PodioHttpClient instance
 */
export function getPodioHttpClient(): PodioHttpClient {
  if (!httpClientInstance) {
    httpClientInstance = new PodioHttpClient();
  }
  return httpClientInstance;
}

/**
 * Reset the singleton instance (useful for testing)
 */
export function resetPodioHttpClient(): void {
  httpClientInstance = null;
}
