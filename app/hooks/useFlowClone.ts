'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  FlowSummary,
  FlowCloneRequest,
  FlowCloneJobStatusResponse,
} from '@/lib/globiflow/types';

/**
 * Hook for managing flow clone operations
 */
export function useFlowClone(sourceAppId?: number, targetAppId?: number) {
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

    try {
      const response = await fetch(`/api/globiflow/apps/${sourceAppId}/flows`);
      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error?.message || 'Failed to load flows');
      }

      setFlows(data.data);
    } catch (error) {
      console.error('Error loading flows:', error);
      setFlowsError(error instanceof Error ? error.message : 'Failed to load flows');
    } finally {
      setFlowsLoading(false);
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

      // Set current job ID and start polling
      setCurrentJobId(data.data.jobId);
      startPollingJobStatus(data.data.jobId);

      // Clear selection
      setSelectedFlowIds(new Set());
    } catch (error) {
      console.error('Error initiating clone:', error);
      setCloneError(error instanceof Error ? error.message : 'Failed to initiate clone');
    } finally {
      setCloning(false);
    }
  }, [sourceAppId, targetAppId, selectedFlowIds]);

  /**
   * Stop polling job status
   */
  const stopPollingJobStatus = useCallback(() => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
  }, []);

  /**
   * Poll job status
   */
  const pollJobStatus = useCallback(async (jobId: string) => {
    try {
      const response = await fetch(`/api/globiflow/jobs/${jobId}`);
      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error?.message || 'Failed to fetch job status');
      }

      setJobStatus(data.data);

      // Stop polling if job is complete or failed
      if (data.data.status === 'completed' || data.data.status === 'failed') {
        stopPollingJobStatus();
      }
    } catch (error) {
      console.error('Error polling job status:', error);
      stopPollingJobStatus();
    }
  }, [stopPollingJobStatus]);

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
    setCurrentJobId(null);
    setJobStatus(null);
  }, [stopPollingJobStatus]);

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
