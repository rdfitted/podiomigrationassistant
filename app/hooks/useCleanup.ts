/**
 * React hook for duplicate cleanup management
 * Handles job creation, progress polling, and approval workflow
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  CleanupRequestPayload,
  CleanupStatusResponse,
  DuplicateGroup,
  CleanupMode,
  KeepStrategy,
} from '@/lib/migration/cleanup/types';
import { useMigrationContext } from '@/app/contexts/MigrationContext';
import type { MigrationJobStatus } from '@/app/contexts/MigrationContext';

interface UseCleanupOptions {
  appId?: number;
  pollInterval?: number; // milliseconds
}

interface UseCleanupReturn {
  // State
  jobId: string | null;
  jobStatus: CleanupStatusResponse | null;
  duplicateGroups: DuplicateGroup[] | null;
  isCreating: boolean;
  isPolling: boolean;
  isExecuting: boolean;
  error: string | null;

  // Actions
  startCleanup: (options: Omit<CleanupRequestPayload, 'appId'>) => Promise<void>;
  executeApprovedGroups: (approvedGroups: DuplicateGroup[]) => Promise<void>;
  loadCleanup: (jobId: string) => Promise<void>;
  stopPolling: () => void;
  reset: () => void;
}

export function useCleanup(options: UseCleanupOptions = {}): UseCleanupReturn {
  const { appId, pollInterval = 3000 } = options;

  // Get migration context
  const { registerJob, unregisterJob, updateJobProgress, updateJobStatus } = useMigrationContext();

  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<CleanupStatusResponse | null>(null);
  const [duplicateGroups, setDuplicateGroups] = useState<DuplicateGroup[] | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isPolling, setIsPolling] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const mountedRef = useRef<boolean>(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
      abortControllerRef.current?.abort('Component unmounted');
    };
  }, []);

  /**
   * Start a new cleanup job
   */
  const startCleanup = useCallback(
    async (cleanupOptions: Omit<CleanupRequestPayload, 'appId'>) => {
      if (!appId) {
        setError('App ID is required');
        return;
      }

      setIsCreating(true);
      setError(null);

      try {
        const payload: CleanupRequestPayload = {
          appId,
          ...cleanupOptions,
        };

        const response = await fetch('/api/migration/cleanup', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.message || 'Failed to create cleanup job');
        }

        if (!mountedRef.current) return;

        const data = await response.json();
        setJobId(data.jobId);
        setIsPolling(true);

        // Register with global migration context
        registerJob({
          jobId: data.jobId,
          tabType: 'cleanup',
          status: 'planning',
          startedAt: new Date(),
          description: `Cleanup duplicates in app ${appId}`
        });
      } catch (err) {
        if (mountedRef.current) {
          setError(err instanceof Error ? err.message : 'Unknown error');
        }
      } finally {
        if (mountedRef.current) {
          setIsCreating(false);
        }
      }
    },
    [appId, registerJob]
  );

  /**
   * Execute cleanup with approved groups (for manual mode)
   */
  const executeApprovedGroups = useCallback(
    async (approvedGroups: DuplicateGroup[]) => {
      if (!jobId) {
        setError('No active cleanup job');
        return;
      }

      setIsExecuting(true);
      setError(null);

      try {
        const response = await fetch(`/api/migration/cleanup/${jobId}/execute`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ approvedGroups }),
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.message || 'Failed to execute cleanup');
        }

        if (!mountedRef.current) return;

        // Start polling for progress
        setIsPolling(true);
      } catch (err) {
        if (mountedRef.current) {
          setError(err instanceof Error ? err.message : 'Unknown error');
        }
      } finally {
        if (mountedRef.current) {
          setIsExecuting(false);
        }
      }
    },
    [jobId]
  );

  /**
   * Poll for job status
   */
  const pollJobStatus = useCallback(async (currentJobId: string) => {
    if (!mountedRef.current) return;

    try {
      // Abort previous request if still in flight
      abortControllerRef.current?.abort('New poll request started');
      abortControllerRef.current = new AbortController();

      // Set up timeout to abort request after 30 seconds
      const timeoutId = setTimeout(() => {
        abortControllerRef.current?.abort('Poll timeout');
      }, 30_000);

      const response = await fetch(`/api/migration/cleanup/${currentJobId}`, {
        signal: abortControllerRef.current.signal,
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        if (!mountedRef.current) return;

        if (response.status === 404) {
          setError('Job not found');
          setIsPolling(false);
          return;
        }
        throw new Error('Failed to fetch job status');
      }

      const data: CleanupStatusResponse = await response.json();

      if (!mountedRef.current) return;

      setJobStatus(data);

      // Update duplicate groups if available
      if (data.duplicateGroups) {
        setDuplicateGroups(data.duplicateGroups);
      }

      // Update global context with progress
      if (data.progress) {
        updateJobProgress('cleanup', {
          total: data.progress.totalItemsToDelete ?? 0,
          processed: data.progress.processedGroups ?? 0,
          successful: data.progress.deletedItems ?? 0,
          failed: data.progress.failedDeletions ?? 0,
          percent: data.progress.percent ?? 0
        });
      }

      // Update global context with status
      updateJobStatus('cleanup', data.status as MigrationJobStatus);

      // Stop polling if job is completed, failed, cancelled, paused, or waiting for approval
      if (
        data.status === 'completed' ||
        data.status === 'failed' ||
        data.status === 'cancelled' ||
        data.status === 'paused' ||
        data.status === 'waiting_approval'
      ) {
        setIsPolling(false);
      }
    } catch (err) {
      // Ignore abort errors (including timeouts - will retry on next poll)
      if (err instanceof Error && (
        err.name === 'AbortError' ||
        err.message === 'Poll timeout' ||
        err.message?.includes('aborted')
      )) {
        // Don't stop polling on timeouts - just let the next interval try again
        return;
      }

      if (!mountedRef.current) return;

      // Log but don't stop polling on transient errors - the job may still be running
      console.warn('Job poll error (will retry):', err instanceof Error ? err.message : err);
      // Only stop polling and show error for definitive failures
      // setError(err instanceof Error ? err.message : 'Failed to poll job status');
      // setIsPolling(false);
    }
  }, [updateJobProgress, updateJobStatus]);

  /**
   * Start polling when jobId is set
   */
  useEffect(() => {
    if (jobId && isPolling) {
      // Initial poll
      pollJobStatus(jobId);

      // Set up interval
      pollIntervalRef.current = setInterval(() => {
        pollJobStatus(jobId);
      }, pollInterval);

      return () => {
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }
        // Abort any in-flight request
        abortControllerRef.current?.abort('Polling effect cleanup');
      };
    }
  }, [jobId, isPolling, pollInterval, pollJobStatus]);

  /**
   * Stop polling manually
   */
  const stopPolling = useCallback(() => {
    if (mountedRef.current) {
      setIsPolling(false);
    }
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    // Abort any in-flight request
    abortControllerRef.current?.abort('Polling stopped manually');
    abortControllerRef.current = null;
  }, []);

  /**
   * Load an existing cleanup job
   */
  const loadCleanup = useCallback(async (existingJobId: string) => {
    setError(null);
    setIsCreating(true);

    try {
      const response = await fetch(`/api/migration/cleanup/${existingJobId}`);

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error('Cleanup job not found');
        }
        throw new Error('Failed to load cleanup job');
      }

      const data: CleanupStatusResponse = await response.json();

      if (!mountedRef.current) return;

      setJobId(existingJobId);
      setJobStatus(data);

      if (data.duplicateGroups) {
        setDuplicateGroups(data.duplicateGroups);
      }

      // Register with global migration context
      registerJob({
        jobId: existingJobId,
        tabType: 'cleanup',
        status: data.status as MigrationJobStatus,
        startedAt: new Date(data.startedAt),
        progress: data.progress ? {
          total: data.progress.totalItemsToDelete,
          processed: data.progress.processedGroups,
          successful: data.progress.deletedItems,
          failed: data.progress.failedDeletions,
          percent: data.progress.percent
        } : undefined,
        description: `Cleanup job ${existingJobId}`
      });

      // Start polling if job is still in progress
      if (
        data.status === 'planning' ||
        data.status === 'detecting' ||
        data.status === 'deleting'
      ) {
        setIsPolling(true);
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : 'Failed to load cleanup job');
      }
    } finally{
      if (mountedRef.current) {
        setIsCreating(false);
      }
    }
  }, [registerJob]);

  /**
   * Reset hook state
   */
  const reset = useCallback(() => {
    stopPolling();
    setJobId(null);
    setJobStatus(null);
    setDuplicateGroups(null);
    setIsCreating(false);
    setIsExecuting(false);
    setError(null);

    // Unregister from global context
    unregisterJob('cleanup');
  }, [stopPolling, unregisterJob]);

  return {
    // State
    jobId,
    jobStatus,
    duplicateGroups,
    isCreating,
    isPolling,
    isExecuting,
    error,

    // Actions
    startCleanup,
    executeApprovedGroups,
    loadCleanup,
    stopPolling,
    reset,
  };
}
