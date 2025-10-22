/**
 * Cleanup Panel Component
 * Allows users to detect and clean up duplicate items in an app
 */

'use client';

import React, { useState, useEffect } from 'react';
import { useCleanup } from '@/app/hooks/useCleanup';
import { DuplicateGroup, CleanupMode, KeepStrategy } from '@/lib/migration/cleanup/types';
import { AppFieldInfo } from './FieldMappingRow';
import { DuplicateGroupsPreview } from './DuplicateGroupsPreview';

export interface CleanupPanelProps {
  appId?: number;
}

export function CleanupPanel({ appId }: CleanupPanelProps) {
  const [matchField, setMatchField] = useState<string>('');
  const [mode, setMode] = useState<CleanupMode>('manual');
  const [keepStrategy, setKeepStrategy] = useState<KeepStrategy>('oldest');
  const [dryRun, setDryRun] = useState<boolean>(true);
  const [batchSize, setBatchSize] = useState<number>(100);
  const [concurrency, setConcurrency] = useState<number>(3);
  const [maxGroups, setMaxGroups] = useState<number | undefined>(undefined);

  // UI state
  const [appFields, setAppFields] = useState<AppFieldInfo[]>([]);
  const [isLoadingFields, setIsLoadingFields] = useState(false);
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);

  const {
    jobId,
    jobStatus,
    duplicateGroups,
    isCreating,
    isPolling,
    isExecuting,
    error,
    startCleanup,
    executeApprovedGroups,
    reset,
  } = useCleanup({ appId });

  // Fetch app field structure when appId changes
  useEffect(() => {
    async function loadFields() {
      if (!appId) {
        setAppFields([]);
        return;
      }

      setIsLoadingFields(true);
      try {
        const response = await fetch(`/api/podio/apps/${appId}/structure`);

        if (response.ok) {
          const app = await response.json();
          setAppFields(app.fields || []);
        }
      } catch (err) {
        console.error('Failed to load field structure:', err);
      } finally {
        setIsLoadingFields(false);
      }
    }

    loadFields();
  }, [appId]);

  const handleStartCleanup = async () => {
    await startCleanup({
      matchField,
      mode,
      keepStrategy: mode === 'automated' ? keepStrategy : 'manual',
      dryRun,
      batchSize,
      concurrency,
      maxGroups,
    });
  };

  const handleApproveAndExecute = async (approvedGroups: DuplicateGroup[]) => {
    await executeApprovedGroups(approvedGroups);
  };

  const handleReset = () => {
    reset();
    setDryRun(true);
  };

  const canStart = !!(appId && matchField);
  const isRunning = isCreating || isPolling || isExecuting;
  const showDuplicateGroups =
    jobStatus &&
    duplicateGroups &&
    duplicateGroups.length > 0 &&
    (jobStatus.status === 'waiting_approval' || jobStatus.status === 'completed');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="border-b border-gray-200 dark:border-gray-700 pb-4">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          Duplicate Cleanup
        </h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Find and remove duplicate items in an app based on matching field values
        </p>
      </div>

      {/* Error Display */}
      {error && (
        <div className="rounded-md bg-red-50 dark:bg-red-900/20 p-4 border border-red-200 dark:border-red-800">
          <div className="flex">
            <div className="flex-shrink-0">
              <svg
                className="h-5 w-5 text-red-400 dark:text-red-500"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
            <div className="ml-3">
              <h3 className="text-sm font-medium text-red-800 dark:text-red-400">Error</h3>
              <div className="mt-2 text-sm text-red-700 dark:text-red-300">{error}</div>
            </div>
          </div>
        </div>
      )}

      {/* Configuration Section */}
      {!jobId && (
        <div className="space-y-4">
          {/* Match Field */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Match Field
              <span className="text-red-500 ml-1">*</span>
            </label>
            <select
              value={matchField}
              onChange={(e) => setMatchField(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
              disabled={isLoadingFields || !appId}
            >
              <option value="">Select a field...</option>
              {appFields.map((field) => (
                <option key={field.external_id} value={field.external_id}>
                  {field.label} ({field.type})
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Items with the same value in this field will be considered duplicates
            </p>
          </div>

          {/* Mode Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Cleanup Mode
            </label>
            <div className="space-y-2">
              <label className="flex items-center">
                <input
                  type="radio"
                  value="manual"
                  checked={mode === 'manual'}
                  onChange={(e) => setMode(e.target.value as CleanupMode)}
                  className="mr-2"
                />
                <span className="text-sm text-gray-900 dark:text-gray-100">
                  Manual - Review and approve each duplicate group
                </span>
              </label>
              <label className="flex items-center">
                <input
                  type="radio"
                  value="automated"
                  checked={mode === 'automated'}
                  onChange={(e) => setMode(e.target.value as CleanupMode)}
                  className="mr-2"
                />
                <span className="text-sm text-gray-900 dark:text-gray-100">
                  Automated - Automatically delete duplicates based on strategy
                </span>
              </label>
            </div>
          </div>

          {/* Keep Strategy (for automated mode) */}
          {mode === 'automated' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Keep Strategy
              </label>
              <select
                value={keepStrategy}
                onChange={(e) => setKeepStrategy(e.target.value as KeepStrategy)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
              >
                <option value="oldest">Keep Oldest - Delete newer duplicates</option>
                <option value="newest">Keep Newest - Delete older duplicates</option>
              </select>
            </div>
          )}

          {/* Dry Run Toggle */}
          <div>
            <label className="flex items-center">
              <input
                type="checkbox"
                checked={dryRun}
                onChange={(e) => setDryRun(e.target.checked)}
                className="mr-2"
              />
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Dry Run (Preview only, no deletions)
              </span>
            </label>
            <p className="mt-1 ml-6 text-xs text-gray-500 dark:text-gray-400">
              Preview duplicate groups without deleting any items
            </p>
          </div>

          {/* Advanced Settings (Collapsible) */}
          <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
            <button
              onClick={() => setShowAdvancedSettings(!showAdvancedSettings)}
              className="flex items-center text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100"
            >
              <svg
                className={`mr-2 h-5 w-5 transition-transform ${
                  showAdvancedSettings ? 'rotate-90' : ''
                }`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 5l7 7-7 7"
                />
              </svg>
              Advanced Settings
            </button>

            {showAdvancedSettings && (
              <div className="mt-4 space-y-4 pl-7">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Batch Size
                  </label>
                  <input
                    type="number"
                    value={batchSize}
                    onChange={(e) => setBatchSize(Number(e.target.value))}
                    min={10}
                    max={500}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                  />
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    Items to delete per batch (10-500)
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Concurrency
                  </label>
                  <input
                    type="number"
                    value={concurrency}
                    onChange={(e) => setConcurrency(Number(e.target.value))}
                    min={1}
                    max={10}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                  />
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    Parallel deletion batches (1-10)
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Max Groups (Testing)
                  </label>
                  <input
                    type="number"
                    value={maxGroups || ''}
                    onChange={(e) => setMaxGroups(e.target.value ? Number(e.target.value) : undefined)}
                    min={1}
                    placeholder="No limit"
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                  />
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    Limit number of duplicate groups to process (for testing)
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Start Button */}
          <div className="flex gap-3">
            <button
              onClick={handleStartCleanup}
              disabled={!canStart || isRunning}
              className={`
                flex-1 px-4 py-2 rounded-md font-medium text-white
                ${
                  canStart && !isRunning
                    ? 'bg-blue-600 hover:bg-blue-700'
                    : 'bg-gray-400 cursor-not-allowed'
                }
              `}
            >
              {isCreating ? 'Starting...' : dryRun ? 'Preview Duplicates' : 'Start Cleanup'}
            </button>
          </div>
        </div>
      )}

      {/* Progress Display */}
      {jobId && jobStatus && (
        <div className="space-y-4">
          {/* Status Badge */}
          <div className="flex items-center justify-between">
            <div>
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Status:
              </span>
              <span
                className={`ml-2 px-2 py-1 rounded-full text-xs font-medium ${
                  jobStatus.status === 'completed'
                    ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                    : jobStatus.status === 'failed'
                    ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
                    : jobStatus.status === 'waiting_approval'
                    ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200'
                    : 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
                }`}
              >
                {jobStatus.status.replace('_', ' ').toUpperCase()}
              </span>
            </div>
            <button
              onClick={handleReset}
              className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
            >
              Start New Cleanup
            </button>
          </div>

          {/* Progress Bar */}
          {jobStatus.progress && jobStatus.progress.percent > 0 && (
            <div>
              <div className="flex justify-between text-sm text-gray-700 dark:text-gray-300 mb-2">
                <span>Progress</span>
                <span>{jobStatus.progress.percent}%</span>
              </div>
              <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                <div
                  className="bg-blue-600 h-2 rounded-full transition-all"
                  style={{ width: `${jobStatus.progress.percent}%` }}
                />
              </div>
            </div>
          )}

          {/* Stats */}
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-gray-50 dark:bg-gray-800 p-3 rounded-md">
              <div className="text-xs text-gray-500 dark:text-gray-400">Groups Found</div>
              <div className="text-2xl font-semibold text-gray-900 dark:text-gray-100">
                {jobStatus.progress.totalGroups}
              </div>
            </div>
            <div className="bg-gray-50 dark:bg-gray-800 p-3 rounded-md">
              <div className="text-xs text-gray-500 dark:text-gray-400">Items Deleted</div>
              <div className="text-2xl font-semibold text-gray-900 dark:text-gray-100">
                {jobStatus.progress.deletedItems}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Duplicate Groups Preview/Approval */}
      {showDuplicateGroups && (
        <DuplicateGroupsPreview
          groups={duplicateGroups}
          mode={mode}
          dryRun={dryRun}
          onApproveAndExecute={handleApproveAndExecute}
          isExecuting={isExecuting}
        />
      )}
    </div>
  );
}
