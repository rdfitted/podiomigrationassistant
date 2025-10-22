/**
 * React hook for delete items management
 * Handles job creation, progress polling, and error states
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { DeleteJobRequestPayload, DeleteJobStatusResponse } from '@/lib/migration/items/types';

interface UseDeleteItemsOptions {
  appId?: number;
  pollInterval?: number; // milliseconds
}

interface UseDeleteItemsReturn {
  // State
  jobId: string | null;
  jobStatus: DeleteJobStatusResponse | null;
  isCreating: boolean;
  isPolling: boolean;
  error: string | null;

  // Actions
  startDelete: (options: Omit<DeleteJobRequestPayload, 'appId'>) => Promise<void>;
  loadDelete: (jobId: string) => Promise<void>;
  stopPolling: () => void;
  reset: () => void;
}

export function useDeleteItems(options: UseDeleteItemsOptions = {}): UseDeleteItemsReturn {
  const { appId, pollInterval = 3000 } = options;

  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<DeleteJobStatusResponse | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isPolling, setIsPolling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  /**
   * Start a new delete job
   */
  const startDelete = useCallback(
    async (deleteOptions: Omit<DeleteJobRequestPayload, 'appId'>) => {
      if (!appId) {
        setError('App ID is required');
        return;
      }

      setIsCreating(true);
      setError(null);

      try {
        const payload: DeleteJobRequestPayload = {
          appId,
          ...deleteOptions,
        };

        const response = await fetch('/api/delete/items', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.details || errorData.error || 'Failed to create delete job');
        }

        const data = await response.json();
        setJobId(data.jobId);
        setIsPolling(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An error occurred');
        console.error('Failed to start delete job:', err);
      } finally {
        setIsCreating(false);
      }
    },
    [appId]
  );

  /**
   * Load an existing delete job by ID
   */
  const loadDelete = useCallback(async (loadJobId: string) => {
    setJobId(loadJobId);
    setIsPolling(true);
  }, []);

  /**
   * Stop polling for job status
   */
  const stopPolling = useCallback(() => {
    setIsPolling(false);
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }, []);

  /**
   * Reset all state
   */
  const reset = useCallback(() => {
    setJobId(null);
    setJobStatus(null);
    setIsCreating(false);
    setError(null);
    stopPolling();
  }, [stopPolling]);

  /**
   * Poll for job status
   */
  useEffect(() => {
    if (!jobId || !isPolling) {
      return;
    }

    const poll = async () => {
      try {
        const response = await fetch(`/api/delete/items/${jobId}`);

        if (!response.ok) {
          if (response.status === 404) {
            setError('Job not found');
            stopPolling();
            return;
          }
          throw new Error('Failed to fetch job status');
        }

        const data: DeleteJobStatusResponse = await response.json();
        setJobStatus(data);

        // Stop polling if job is completed or failed
        if (data.status === 'completed' || data.status === 'failed') {
          stopPolling();
        }
      } catch (err) {
        console.error('Error polling job status:', err);
        setError(err instanceof Error ? err.message : 'Failed to fetch job status');
      }
    };

    // Poll immediately
    poll();

    // Set up polling interval
    pollIntervalRef.current = setInterval(poll, pollInterval);

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [jobId, isPolling, pollInterval, stopPolling]);

  return {
    jobId,
    jobStatus,
    isCreating,
    isPolling,
    error,
    startDelete,
    loadDelete,
    stopPolling,
    reset,
  };
}
