'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  FlowSummary,
  FlowCloneRequest,
  FlowCloneJobStatusResponse,
} from '@/lib/globiflow/types';
import { useMigrationContext } from '@/app/contexts/MigrationContext';
import type { MigrationJobStatus } from '@/app/contexts/MigrationContext';

/**
 * Hook for managing flow clone operations
 */
export function useFlowClone(sourceAppId?: number, targetAppId?: number) {
  // Get migration context
  const { registerJob, unregisterJob, updateJobProgress, updateJobStatus } = useMigrationContext();

  const [flows, setFlows] = useState<FlowSummary[]>([]);
  const [flowsLoading, setFlowsLoading] = useState(false);
  const [flowsError, setFlowsError] = useState<string | null>(null);

  const [selectedFlowIds, setSelectedFlowIds] = useState<Set<string>>(new Set());

  const [cloning, setCloning] = useState(false);
  const [cloneError, setCloneError] = useState<string | null>(null);

  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<FlowCloneJobStatusResponse | null>(null);

  // Use ref to avoid stale closures
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const mountedRef = useRef<boolean>(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
      abortControllerRef.current?.abort('Component unmounted');
    };
  }, []);

  /**
   * Load flows for the source app
   */
  const loadFlows = useCallback(async () => {
    if (!sourceAppId) {
      setFlows([]);
      return;
    }

    setFlowsLoading(true);
    setFlowsError(null);

    const abortController = new AbortController();

    try {
      const response = await fetch(`/api/globiflow/apps/${sourceAppId}/flows`, {
        signal: abortController.signal
      });
      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error?.message || 'Failed to load flows');
      }

      if (mountedRef.current) {
        setFlows(data.data);
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;

      console.error('Error loading flows:', error);
      if (mountedRef.current) {
        setFlowsError(error instanceof Error ? error.message : 'Failed to load flows');
      }
    } finally {
      if (mountedRef.current) {
        setFlowsLoading(false);
      }
    }
  }, [sourceAppId]);

  /**
   * Toggle flow selection
   */
  const toggleFlowSelection = useCallback((flowId: string) => {
    setSelectedFlowIds((prev) => {
      const next = new Set(prev);
      if (next.has(flowId)) {
        next.delete(flowId);
      } else {
        next.add(flowId);
      }
      return next;
    });
  }, []);

  /**
   * Select all flows
   */
  const selectAllFlows = useCallback(() => {
    setSelectedFlowIds(new Set(flows.map((f) => f.id)));
  }, [flows]);

  /**
   * Deselect all flows
   */
  const deselectAllFlows = useCallback(() => {
    setSelectedFlowIds(new Set());
  }, []);

  /**
   * Initiate clone operation
   */
  const initiateClone = useCallback(async () => {
    if (!sourceAppId || !targetAppId || selectedFlowIds.size === 0) {
      return;
    }

    setCloning(true);
    setCloneError(null);

    try {
      const request: FlowCloneRequest = {
        sourceAppId,
        targetAppId,
        flows: Array.from(selectedFlowIds).map((flowId) => ({ flowId })),
        continueOnError: true,
      };

      const response = await fetch('/api/globiflow/clone', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error?.message || 'Failed to initiate clone');
      }

      if (!mountedRef.current) return;

      // Set current job ID and start polling
      setCurrentJobId(data.data.jobId);
      startPollingJobStatus(data.data.jobId);

      // Register with global migration context
      registerJob({
        jobId: data.data.jobId,
        tabType: 'flow_clone',
        status: 'planning',
        startedAt: new Date(),
        description: `Cloning ${selectedFlowIds.size} flows from app ${sourceAppId} to ${targetAppId}`
      });

      // Clear selection
      setSelectedFlowIds(new Set());
    } catch (error) {
      console.error('Error initiating clone:', error);
      if (mountedRef.current) {
        setCloneError(error instanceof Error ? error.message : 'Failed to initiate clone');
      }
    } finally {
      if (mountedRef.current) {
        setCloning(false);
      }
    }
  }, [sourceAppId, targetAppId, selectedFlowIds, registerJob]);

  /**
   * Stop polling job status
   */
  const stopPollingJobStatus = useCallback(() => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
    // Abort any in-flight request
    abortControllerRef.current?.abort('Polling stopped manually');
    abortControllerRef.current = null;
  }, []);

  /**
   * Poll job status
   */
  const pollJobStatus = useCallback(async (jobId: string) => {
    if (!mountedRef.current) return;

    try {
      // Abort previous request if still in flight
      abortControllerRef.current?.abort('New poll request started');
      abortControllerRef.current = new AbortController();

      const response = await fetch(`/api/globiflow/jobs/${jobId}`, {
        signal: abortControllerRef.current.signal,
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error?.message || 'Failed to fetch job status');
      }

      if (!mountedRef.current) return;

      setJobStatus(data.data);

      // Update global context with progress
      if (data.data.results) {
        const total = data.data.results.length;
        const successful = data.data.results.filter((r: any) => r.success).length;
        const failed = data.data.results.filter((r: any) => !r.success).length;
        const processed = successful + failed;

        updateJobProgress('flow_clone', {
          total,
          processed,
          successful,
          failed,
          percent: total > 0 ? Math.round((processed / total) * 100) : 0
        });
      }

      // Update global context with status
      updateJobStatus('flow_clone', data.data.status as MigrationJobStatus);

      // Stop polling if job is complete or failed
      if (data.data.status === 'completed' || data.data.status === 'failed') {
        stopPollingJobStatus();
      }
    } catch (error) {
      // Ignore abort errors
      if (error instanceof Error && error.name === 'AbortError') {
        return;
      }
      console.error('Error polling job status:', error);
      if (mountedRef.current) {
        stopPollingJobStatus();
      }
    }
  }, [stopPollingJobStatus, updateJobProgress, updateJobStatus]);

  /**
   * Start polling job status
   */
  const startPollingJobStatus = useCallback(
    (jobId: string) => {
      // Clear any existing interval
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }

      // Poll immediately
      pollJobStatus(jobId);

      // Set up polling interval (every 2 seconds)
      pollingIntervalRef.current = setInterval(() => {
        pollJobStatus(jobId);
      }, 2000);
    },
    [pollJobStatus]
  );

  /**
   * Clear current job
   */
  const clearCurrentJob = useCallback(() => {
    stopPollingJobStatus();
    if (mountedRef.current) {
      setCurrentJobId(null);
      setJobStatus(null);
    }

    // Unregister from global context
    unregisterJob('flow_clone');
  }, [stopPollingJobStatus, unregisterJob]);

  /**
   * Load flows when source app changes
   */
  useEffect(() => {
    if (sourceAppId) {
      loadFlows();
    } else {
      setFlows([]);
      setSelectedFlowIds(new Set());
    }
  }, [sourceAppId, loadFlows]);

  /**
   * Cleanup polling on unmount
   */
  useEffect(() => {
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
      // Abort any in-flight request
      abortControllerRef.current?.abort('Effect cleanup');
    };
  }, []);

  return {
    // Flow data
    flows,
    flowsLoading,
    flowsError,
    reloadFlows: loadFlows,

    // Selection
    selectedFlowIds,
    toggleFlowSelection,
    selectAllFlows,
    deselectAllFlows,

    // Clone operation
    cloning,
    cloneError,
    initiateClone,
    canInitiateClone: sourceAppId && targetAppId && selectedFlowIds.size > 0,

    // Job status
    currentJobId,
    jobStatus,
    clearCurrentJob,
  };
}
