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

// localStorage persistence for cleanup job state
const CLEANUP_STORAGE_KEY = 'podio-cleanup-active-job';
const CLEANUP_STORAGE_TTL = 24 * 60 * 60 * 1000; // 24 hours

interface StoredCleanupJob {
  jobId: string;
  appId: number;
  savedAt: string;
  expiresAt: string;
}

/**
 * Load cleanup job from localStorage (SSR-safe)
 */
function loadCleanupJobFromStorage(): StoredCleanupJob | null {
  if (typeof window === 'undefined' || !window.localStorage) return null;

  try {
    const stored = localStorage.getItem(CLEANUP_STORAGE_KEY);
    if (!stored) return null;

    const parsed = JSON.parse(stored);

    // Validate parsed structure before using it
    if (
      !parsed ||
      typeof parsed.jobId !== 'string' ||
      typeof parsed.appId !== 'number' ||
      typeof parsed.expiresAt !== 'string'
    ) {
      console.warn('[useCleanup] Invalid stored job format, clearing storage');
      localStorage.removeItem(CLEANUP_STORAGE_KEY);
      return null;
    }

    const now = Date.now();

    // Check if expired
    if (new Date(parsed.expiresAt).getTime() < now) {
      localStorage.removeItem(CLEANUP_STORAGE_KEY);
      return null;
    }

    return parsed as StoredCleanupJob;
  } catch (error) {
    // Handle specific localStorage errors gracefully
    if (error instanceof DOMException && error.name === 'SecurityError') {
      // localStorage blocked by security policy (private browsing, etc.)
      return null;
    }
    console.error('Failed to load cleanup job from storage:', error);
    return null;
  }
}

/**
 * Save cleanup job to localStorage (SSR-safe)
 */
function saveCleanupJobToStorage(jobId: string, appId: number): void {
  if (typeof window === 'undefined' || !window.localStorage) return;

  try {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + CLEANUP_STORAGE_TTL);

    const toStore: StoredCleanupJob = {
      jobId,
      appId,
      savedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };

    localStorage.setItem(CLEANUP_STORAGE_KEY, JSON.stringify(toStore));
  } catch (error) {
    // Handle specific localStorage errors gracefully
    if (error instanceof DOMException) {
      if (error.name === 'QuotaExceededError') {
        console.warn('[useCleanup] localStorage quota exceeded, cannot persist cleanup job');
        return;
      }
      if (error.name === 'SecurityError') {
        // localStorage blocked by security policy (private browsing, etc.)
        return;
      }
    }
    console.error('Failed to save cleanup job to storage:', error);
  }
}

/**
 * Clear cleanup job from localStorage (SSR-safe)
 */
function clearCleanupJobFromStorage(): void {
  if (typeof window === 'undefined' || !window.localStorage) return;

  try {
    localStorage.removeItem(CLEANUP_STORAGE_KEY);
  } catch (error) {
    // Handle specific localStorage errors gracefully
    if (error instanceof DOMException && error.name === 'SecurityError') {
      // localStorage blocked by security policy (private browsing, etc.)
      return;
    }
    console.error('Failed to clear cleanup job from storage:', error);
  }
}

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
      abortControllerRef.current?.abort(new DOMException('Component unmounted', 'AbortError'));
    };
  }, []);

  /**
   * Auto-reconnect to saved cleanup job on mount
   * Checks localStorage for a saved job and loads it if valid
   */
  useEffect(() => {
    const autoReconnectController = new AbortController();
    const storedJob = loadCleanupJobFromStorage();

    // Only auto-reconnect if:
    // 1. We have a stored job
    // 2. No job is currently active (jobId is null)
    // 3. The stored appId matches current appId (if appId is provided)
    if (storedJob && !jobId && (!appId || storedJob.appId === appId)) {
      // Use an async IIFE to call loadCleanup
      (async () => {
        try {
          const response = await fetch(`/api/migration/cleanup/${storedJob.jobId}`, {
            signal: autoReconnectController.signal,
          });

          if (!response.ok) {
            // Job not found or invalid - clear storage
            clearCleanupJobFromStorage();
            return;
          }

          const data: CleanupStatusResponse = await response.json();

          // Don't restore completed/failed/cancelled jobs
          if (['completed', 'failed', 'cancelled'].includes(data.status)) {
            clearCleanupJobFromStorage();
            return;
          }

          if (!mountedRef.current) return;

          // Restore the job state
          setJobId(storedJob.jobId);
          setJobStatus(data);

          if (data.duplicateGroups) {
            setDuplicateGroups(data.duplicateGroups);
          }

          // Register with global migration context
          registerJob({
            jobId: storedJob.jobId,
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
            description: `Cleanup job ${storedJob.jobId}`
          });

          // Start polling if job is still in progress
          if (['planning', 'detecting', 'deleting'].includes(data.status)) {
            setIsPolling(true);
          }
        } catch (err) {
          // Ignore abort errors (component unmounted)
          if (err instanceof Error && err.name === 'AbortError') {
            return;
          }
          if (mountedRef.current) {
            setError(err instanceof Error ? err.message : 'Failed to restore cleanup job');
            clearCleanupJobFromStorage();
            unregisterJob('cleanup'); // Clean up global context if partially registered
          }
        }
      })();
    }

    return () => {
      autoReconnectController.abort();
    };
  }, [appId]); // Run when appId changes to restore jobs for the correct app context

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

        // Persist to localStorage for page refresh recovery
        saveCleanupJobToStorage(data.jobId, appId);

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
      abortControllerRef.current?.abort(new DOMException('New poll request started', 'AbortError'));
      abortControllerRef.current = new AbortController();

      // Set up timeout to abort request after 30 seconds
      const timeoutId = setTimeout(() => {
        abortControllerRef.current?.abort(new DOMException('Poll timeout', 'AbortError'));
      }, 30_000);

      try {
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

        // Clear localStorage for terminal states (job ended, no need to persist)
        if (
          data.status === 'completed' ||
          data.status === 'failed' ||
          data.status === 'cancelled'
        ) {
          clearCleanupJobFromStorage();
        }

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
      } catch (innerErr) {
        // Clear timeout on error path to prevent memory leak
        clearTimeout(timeoutId);
        throw innerErr;
      }
    } catch (err) {
      // Ignore abort errors (including timeouts - will retry on next poll)
      if (err instanceof Error && (
        err.name === 'AbortError' ||
        err.message === 'Poll timeout' ||
        err.message === 'New poll request started' ||
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
        abortControllerRef.current?.abort(new DOMException('Polling effect cleanup', 'AbortError'));
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
    abortControllerRef.current?.abort(new DOMException('Polling stopped manually', 'AbortError'));
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

      // Persist to localStorage for page refresh recovery (if we have an appId)
      if (appId) {
        saveCleanupJobToStorage(existingJobId, appId);
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
        // Clear storage if job load fails (job may be invalid/expired)
        clearCleanupJobFromStorage();
      }
    } finally{
      if (mountedRef.current) {
        setIsCreating(false);
      }
    }
  }, [appId, registerJob]);

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

    // Clear persisted job from localStorage
    clearCleanupJobFromStorage();

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
