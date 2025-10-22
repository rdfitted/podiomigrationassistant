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

  const { updateRateLimitInfo, hasActiveJobs } = useMigrationContext();
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const mountedRef = useRef<boolean>(true);
  const errorCountRef = useRef<number>(0);

  const fetchStatus = useCallback(async () => {
    if (!mountedRef.current) return;

    try {
      setIsLoading(true);
      setError(null);

      const response = await fetch('/api/rate-limit/status');
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
      if (!mountedRef.current) return;

      errorCountRef.current++;
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      console.error('Failed to fetch rate limit status:', error);
    } finally {
      if (mountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [updateRateLimitInfo]);

  useEffect(() => {
    mountedRef.current = true;

    if (!enabled) {
      return;
    }

    // Initial fetch
    fetchStatus();

    // Set up polling
    const scheduleNext = () => {
      if (!mountedRef.current) return;

      // Determine poll interval based on state
      let interval = pollInterval;

      if (adaptivePolling) {
        // Poll more frequently when:
        // 1. Rate limited (every 2 seconds)
        // 2. Has active jobs (every 3 seconds)
        // 3. Otherwise use default interval
        if (status.isLimited) {
          interval = 2000;
        } else if (hasActiveJobs()) {
          interval = 3000;
        }
      }

      // Apply exponential backoff if there have been errors
      if (errorCountRef.current > 0) {
        interval = Math.min(interval * Math.pow(2, errorCountRef.current), 60000);
      }

      timeoutRef.current = setTimeout(() => {
        fetchStatus().then(scheduleNext);
      }, interval);
    };

    scheduleNext();

    return () => {
      mountedRef.current = false;
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [enabled, pollInterval, adaptivePolling, status.isLimited, hasActiveJobs, fetchStatus]);

  const refresh = useCallback(() => {
    return fetchStatus();
  }, [fetchStatus]);

  return {
    status,
    isLoading,
    error,
    refresh
  };
}
