/**
 * React hook for item migration management
 * Handles job creation, progress polling, and error states
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { ItemMigrationRequestPayload, ItemMigrationStatusResponse, FieldMapping } from '@/lib/migration/items/types';
import { useMigrationContext } from '@/app/contexts/MigrationContext';
import type { MigrationJobStatus } from '@/app/contexts/MigrationContext';

interface UseItemMigrationOptions {
  sourceAppId?: number;
  targetAppId?: number;
  pollInterval?: number; // milliseconds
}

interface UseItemMigrationReturn {
  // State
  jobId: string | null;
  jobStatus: ItemMigrationStatusResponse | null;
  isCreating: boolean;
  isPolling: boolean;
  isRetrying: boolean;
  error: string | null;
  fieldMapping: FieldMapping | null;
  fieldMappingOverride: FieldMapping | null;

  // Actions
  startMigration: (options: Omit<ItemMigrationRequestPayload, 'sourceAppId' | 'targetAppId'>) => Promise<void>;
  loadMigration: (jobId: string) => Promise<void>;
  retryFailedItems: (jobId: string, fieldMapping?: FieldMapping) => Promise<void>;
  updateFieldMapping: (mapping: FieldMapping) => void;
  stopPolling: () => void;
  reset: () => void;
}

export function useItemMigration(options: UseItemMigrationOptions = {}): UseItemMigrationReturn {
  const { sourceAppId, targetAppId, pollInterval = 3000 } = options;

  // Get migration context
  const { registerJob, unregisterJob, updateJobProgress, updateJobStatus } = useMigrationContext();

  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<ItemMigrationStatusResponse | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isPolling, setIsPolling] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldMapping, setFieldMapping] = useState<FieldMapping | null>(null);
  const [fieldMappingOverride, setFieldMappingOverride] = useState<FieldMapping | null>(null);

  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  /**
   * Update field mapping override
   */
  const updateFieldMapping = useCallback((mapping: FieldMapping) => {
    setFieldMappingOverride(mapping);
  }, []);

  /**
   * Start a new migration job
   */
  const startMigration = useCallback(
    async (migrationOptions: Omit<ItemMigrationRequestPayload, 'sourceAppId' | 'targetAppId'>) => {
      if (!sourceAppId || !targetAppId) {
        setError('Source and target app IDs are required');
        return;
      }

      setIsCreating(true);
      setError(null);

      try {
        const payload: ItemMigrationRequestPayload = {
          sourceAppId,
          targetAppId,
          ...migrationOptions,
          fieldMapping: fieldMappingOverride || migrationOptions.fieldMapping,
        };

        // Only include maxItems if it's defined
        if (migrationOptions.maxItems !== undefined) {
          payload.maxItems = migrationOptions.maxItems;
        }

        const response = await fetch('/api/migration/items', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.message || 'Failed to create migration job');
        }

        const data = await response.json();
        setJobId(data.jobId);
        setFieldMapping(data.fieldMapping);
        setIsPolling(true);

        // Register with global migration context
        registerJob({
          jobId: data.jobId,
          tabType: 'item_migration',
          status: 'planning',
          startedAt: new Date(),
          description: `Migrating items from app ${sourceAppId} to ${targetAppId}`
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setIsCreating(false);
      }
    },
    [sourceAppId, targetAppId, fieldMappingOverride, registerJob]
  );

  /**
   * Poll for job status
   */
  const pollJobStatus = useCallback(async (currentJobId: string) => {
    try {
      const response = await fetch(`/api/migration/items/${currentJobId}`);

      if (!response.ok) {
        if (response.status === 404) {
          setError('Job not found');
          setIsPolling(false);
          return;
        }
        throw new Error('Failed to fetch job status');
      }

      const data: ItemMigrationStatusResponse = await response.json();
      setJobStatus(data);

      // Update global context with progress
      if (data.progress) {
        updateJobProgress('item_migration', {
          total: data.progress.total,
          processed: data.progress.processed,
          successful: data.progress.successful,
          failed: data.progress.failed,
          percent: data.progress.percent
        });
      }

      // Update global context with status
      updateJobStatus('item_migration', data.status as MigrationJobStatus);

      // Stop polling if job is completed or failed
      if (data.status === 'completed' || data.status === 'failed') {
        setIsPolling(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to poll job status');
      setIsPolling(false);
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
   * Load an existing migration job
   */
  const loadMigration = useCallback(async (existingJobId: string) => {
    setError(null);
    setIsCreating(true);

    try {
      const response = await fetch(`/api/migration/items/${existingJobId}`);

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error('Migration job not found');
        }
        throw new Error('Failed to load migration job');
      }

      const data: ItemMigrationStatusResponse = await response.json();
      setJobId(existingJobId);
      setJobStatus(data);
      // Note: Field mapping is stored in job metadata and used during resumption
      // We don't need to set it here for UI purposes

      // Register with global migration context
      registerJob({
        jobId: existingJobId,
        tabType: 'item_migration',
        status: data.status as MigrationJobStatus,
        startedAt: new Date(data.startedAt),
        progress: data.progress ? {
          total: data.progress.total,
          processed: data.progress.processed,
          successful: data.progress.successful,
          failed: data.progress.failed,
          percent: data.progress.percent
        } : undefined,
        description: `Migration job ${existingJobId}`
      });

      // Start polling if job is still in progress or paused
      if (data.status === 'in_progress' || data.status === 'paused') {
        setIsPolling(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load migration');
    } finally {
      setIsCreating(false);
    }
  }, [registerJob]);

  /**
   * Retry failed items from a migration job
   */
  const retryFailedItems = useCallback(async (retryJobId: string, retryFieldMapping?: FieldMapping) => {
    setIsRetrying(true);
    setError(null);

    try {
      const response = await fetch(`/api/migration/items/${retryJobId}/retry`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: retryFieldMapping ? JSON.stringify({ fieldMapping: retryFieldMapping }) : undefined,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to retry migration');
      }

      await response.json();

      // Start polling to track retry progress
      setIsPolling(true);

      // Trigger immediate status update
      await pollJobStatus(retryJobId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to retry migration');
    } finally {
      setIsRetrying(false);
    }
  }, [pollJobStatus]);

  /**
   * Reset hook state
   */
  const reset = useCallback(() => {
    stopPolling();
    setJobId(null);
    setJobStatus(null);
    setError(null);
    setFieldMapping(null);
    setFieldMappingOverride(null);
    setIsCreating(false);
    setIsRetrying(false);

    // Unregister from global context
    unregisterJob('item_migration');
  }, [stopPolling, unregisterJob]);

  return {
    jobId,
    jobStatus,
    isCreating,
    isPolling,
    isRetrying,
    error,
    fieldMapping,
    fieldMappingOverride,
    updateFieldMapping,
    startMigration,
    loadMigration,
    retryFailedItems,
    stopPolling,
    reset,
  };
}
