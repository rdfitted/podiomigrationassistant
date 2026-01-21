'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useMigrationContext } from '@/app/contexts/MigrationContext';

export interface RateLimitStatus {
  hasData: boolean;
  limit: number | null;
  remaining: number | null;
  resetAt: string | null;
  isLimited: boolean;
  timeUntilReset: number | null;
  percentUsed: number | null;
  lastUpdated?: string;
}

const MAX_CONSECUTIVE_ERRORS = 5;
const MAX_BACKOFF_INTERVAL = 60000; // 1 minute

interface UseRateLimitStatusOptions {
  /** Whether to enable polling (default: true) */
  enabled?: boolean;
  /** Polling interval in milliseconds (default: 5000) */
  pollInterval?: number;
  /** Whether to poll more frequently when rate limited (default: true) */
  adaptivePolling?: boolean;
}

/**
 * Hook to monitor API rate limit status
 *
 * Features:
 * - Polls rate limit status API endpoint
 * - Updates global migration context with rate limit info
 * - Adaptive polling when rate limited
 * - Automatic cleanup on unmount
 */
export function useRateLimitStatus(options: UseRateLimitStatusOptions = {}) {
  const {
    enabled = true,
    pollInterval = 5000,
    adaptivePolling = true
  } = options;

  const [status, setStatus] = useState<RateLimitStatus>({
    hasData: false,
    limit: null,
    remaining: null,
    resetAt: null,
    isLimited: false,
    timeUntilReset: null,
    percentUsed: null
  });
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);
  const [isPaused, setIsPaused] = useState<boolean>(false);

  const { updateRateLimitInfo, hasActiveJobs } = useMigrationContext();
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef<boolean>(true);
  const errorCountRef = useRef<number>(0);
  const isPollingRef = useRef<boolean>(false);
  const statusRef = useRef(status);
  const scheduleNextRef = useRef<(() => void) | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const fetchStatus = useCallback(async () => {
    if (!mountedRef.current) return;

    // Abort any previous in-flight request
    abortControllerRef.current?.abort('New request started');
    abortControllerRef.current = new AbortController();

    // Set up timeout to abort request after 10 seconds
    const timeoutId = setTimeout(() => {
      abortControllerRef.current?.abort('Request timeout');
    }, 10_000);

    try {
      setIsLoading(true);
      setError(null);

      const response = await fetch('/api/rate-limit/status', {
        // Add cache prevention to avoid stale data
        cache: 'no-store',
        // Add timeout to prevent hanging requests
        signal: abortControllerRef.current.signal
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Failed to fetch rate limit status: ${response.statusText}`);
      }

      const data: RateLimitStatus = await response.json();

      // Validate critical fields
      if (typeof data.hasData !== 'boolean' ||
          (data.limit !== null && typeof data.limit !== 'number') ||
          (data.remaining !== null && typeof data.remaining !== 'number')) {
        throw new Error('Invalid rate limit status response format');
      }

      if (!mountedRef.current) return;

      // Reset error count on successful fetch
      errorCountRef.current = 0;
      setIsPaused(false);

      setStatus(data);

      // Update global context
      if (data.hasData && data.limit !== null && data.remaining !== null && data.resetAt !== null) {
        updateRateLimitInfo({
          limit: data.limit,
          remaining: data.remaining,
          resetAt: data.resetAt,
          isLimited: data.isLimited,
          timeUntilReset: data.timeUntilReset ?? undefined
        });
      }
    } catch (err) {
      clearTimeout(timeoutId);

      // Ignore abort errors (component unmounted or new request started)
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }

      if (!mountedRef.current) return;

      errorCountRef.current++;
      const error = err instanceof Error ? err : new Error(String(err));

      // Check if we've exceeded max consecutive errors
      if (errorCountRef.current >= MAX_CONSECUTIVE_ERRORS) {
        setIsPaused(true);
        console.warn(
          `Rate limit status polling paused after ${MAX_CONSECUTIVE_ERRORS} consecutive errors. ` +
          `Last error: ${error.message}`
        );
      } else {
        console.error(
          `Failed to fetch rate limit status (attempt ${errorCountRef.current}/${MAX_CONSECUTIVE_ERRORS}):`,
          error
        );
      }

      setError(error);
    } finally {
      if (mountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [updateRateLimitInfo]);

  // Keep statusRef in sync with status
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    mountedRef.current = true;

    if (!enabled) {
      return;
    }

    // Allow rebuild; clear any existing timeout
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    isPollingRef.current = true;

    // Set up polling loop with error handling
    const scheduleNext = () => {
      if (!mountedRef.current || !isPollingRef.current) return;

      // Stop polling if we've exceeded max errors
      if (errorCountRef.current >= MAX_CONSECUTIVE_ERRORS) {
        console.warn('Rate limit status polling stopped due to repeated failures');
        isPollingRef.current = false;
        return;
      }

      // Determine poll interval based on state
      let interval = pollInterval;

      if (adaptivePolling) {
        // Poll more frequently when:
        // 1. Rate limited (every 2 seconds)
        // 2. Has active jobs (every 3 seconds)
        // 3. Otherwise use default interval
        if (statusRef.current.isLimited) {
          interval = 2000;
        } else if (hasActiveJobs()) {
          interval = 3000;
        }
      }

      // Apply exponential backoff if there have been errors
      if (errorCountRef.current > 0) {
        const backoffMultiplier = Math.pow(2, errorCountRef.current - 1);
        interval = Math.min(interval * backoffMultiplier, MAX_BACKOFF_INTERVAL);
      }

      timeoutRef.current = setTimeout(async () => {
        try {
          await fetchStatus();
        } catch (err) {
          // Error is already handled in fetchStatus, just log here
          console.debug('fetchStatus error caught in polling loop:', err);
        } finally {
          // Always schedule next poll, even if fetch failed
          scheduleNext();
        }
      }, interval);
    };
    scheduleNextRef.current = scheduleNext;

    // Initial fetch with delay to avoid hydration issues
    const initialTimeout = setTimeout(() => {
      fetchStatus()
        .catch(err => {
          console.debug('Initial fetchStatus error:', err);
        })
        .finally(() => {
          scheduleNext();
        });
    }, 100); // Small delay to allow component to fully mount

    return () => {
      mountedRef.current = false;
      isPollingRef.current = false;
      clearTimeout(initialTimeout);
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      // Abort any in-flight request on unmount
      abortControllerRef.current?.abort('Component unmounted');
      scheduleNextRef.current = null;
    };
  }, [enabled, pollInterval, adaptivePolling, hasActiveJobs, fetchStatus]);

  const refresh = useCallback(async () => {
    // Reset error count and paused state on manual refresh
    errorCountRef.current = 0;
    setIsPaused(false);
    isPollingRef.current = true;
    await fetchStatus();
    if (mountedRef.current && scheduleNextRef.current) {
      scheduleNextRef.current();
    }
  }, [fetchStatus]);

  return {
    status,
    isLoading,
    error,
    isPaused,
    refresh
  };
}
