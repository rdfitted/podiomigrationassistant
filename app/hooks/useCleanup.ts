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

  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<CleanupStatusResponse | null>(null);
  const [duplicateGroups, setDuplicateGroups] = useState<DuplicateGroup[] | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isPolling, setIsPolling] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

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

        const data = await response.json();
        setJobId(data.jobId);
        setIsPolling(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setIsCreating(false);
      }
    },
    [appId]
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

        // Start polling for progress
        setIsPolling(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setIsExecuting(false);
      }
    },
    [jobId]
  );

  /**
   * Poll for job status
   */
  const pollJobStatus = useCallback(async (currentJobId: string) => {
    try {
      const response = await fetch(`/api/migration/cleanup/${currentJobId}`);

      if (!response.ok) {
        if (response.status === 404) {
          setError('Job not found');
          setIsPolling(false);
          return;
        }
        throw new Error('Failed to fetch job status');
      }

      const data: CleanupStatusResponse = await response.json();
      setJobStatus(data);

      // Update duplicate groups if available
      if (data.duplicateGroups) {
        setDuplicateGroups(data.duplicateGroups);
      }

      // Stop polling if job is completed, failed, or waiting for approval
      if (
        data.status === 'completed' ||
        data.status === 'failed' ||
        data.status === 'waiting_approval'
      ) {
        setIsPolling(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to poll job status');
      setIsPolling(false);
    }
  }, []);

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
        }
      };
    }
  }, [jobId, isPolling, pollInterval, pollJobStatus]);

  /**
   * Stop polling manually
   */
  const stopPolling = useCallback(() => {
    setIsPolling(false);
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
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
      setJobId(existingJobId);
      setJobStatus(data);

      if (data.duplicateGroups) {
        setDuplicateGroups(data.duplicateGroups);
      }

      // Start polling if job is still in progress or detecting
      if (
        data.status === 'in_progress' ||
        data.status === 'detecting' ||
        data.status === 'deleting'
      ) {
        setIsPolling(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load cleanup job');
    } finally {
      setIsCreating(false);
    }
  }, []);

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
  }, [stopPolling]);

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
