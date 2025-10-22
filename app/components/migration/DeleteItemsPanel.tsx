'use client';

import React, { useState } from 'react';
import { useDeleteItems } from '@/app/hooks/useDeleteItems';
import { DeleteProgress } from './DeleteProgress';

interface DeleteItemsPanelProps {
  appId: number;
  appName?: string;
}

/**
 * Delete Items Panel Component
 * Provides UI for batch item deletion with progress tracking
 */
export function DeleteItemsPanel({ appId, appName }: DeleteItemsPanelProps) {
  const [maxItems, setMaxItems] = useState<number | undefined>(undefined);
  const [dryRun, setDryRun] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [concurrency, setConcurrency] = useState(5);
  const [stopOnError, setStopOnError] = useState(false);

  const { jobId, jobStatus, isCreating, isPolling, error, startDelete, reset } = useDeleteItems({
    appId,
    pollInterval: 2000,
  });

  const handleStartDelete = async () => {
    await startDelete({
      maxItems,
      dryRun,
      concurrency,
      stopOnError,
    });
  };

  const handleReset = () => {
    reset();
    setMaxItems(undefined);
    setDryRun(false);
  };

  return (
    <div className="space-y-6">
      <div className="border-b border-gray-200 dark:border-gray-700 pb-4">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Delete Items</h2>
        {appName && (
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
            From: <span className="font-medium">{appName}</span>
          </p>
        )}
      </div>

      {/* Configuration Form */}
      {!jobId && (
        <div className="space-y-4">
          <div>
            <label
              htmlFor="maxItems"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
            >
              Max Items (optional)
            </label>
            <input
              type="number"
              id="maxItems"
              value={maxItems || ''}
              onChange={(e) => setMaxItems(e.target.value ? parseInt(e.target.value) : undefined)}
              placeholder="All items"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
              disabled={isCreating}
            />
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Leave empty to delete all items in the app
            </p>
          </div>

          <div className="flex items-center">
            <input
              type="checkbox"
              id="dryRun"
              checked={dryRun}
              onChange={(e) => setDryRun(e.target.checked)}
              className="mr-2"
              disabled={isCreating}
            />
            <label htmlFor="dryRun" className="text-sm text-gray-700 dark:text-gray-300">
              Dry Run (preview only, don't actually delete)
            </label>
          </div>

          {/* Advanced Options */}
          <div>
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
              disabled={isCreating}
            >
              {showAdvanced ? 'Hide' : 'Show'} Advanced Options
            </button>

            {showAdvanced && (
              <div className="mt-4 space-y-4 p-4 bg-gray-50 dark:bg-gray-800 rounded-md">
                <div>
                  <label
                    htmlFor="concurrency"
                    className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
                  >
                    Concurrency: {concurrency}
                  </label>
                  <input
                    type="range"
                    id="concurrency"
                    min="1"
                    max="10"
                    value={concurrency}
                    onChange={(e) => setConcurrency(parseInt(e.target.value))}
                    className="w-full"
                    disabled={isCreating}
                  />
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    Number of concurrent delete operations (1-10)
                  </p>
                </div>

                <div className="flex items-center">
                  <input
                    type="checkbox"
                    id="stopOnError"
                    checked={stopOnError}
                    onChange={(e) => setStopOnError(e.target.checked)}
                    className="mr-2"
                    disabled={isCreating}
                  />
                  <label htmlFor="stopOnError" className="text-sm text-gray-700 dark:text-gray-300">
                    Stop on first error
                  </label>
                </div>
              </div>
            )}
          </div>

          {/* Error Display */}
          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md p-4">
              <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
            </div>
          )}

          {/* Start Button */}
          <button
            onClick={handleStartDelete}
            disabled={isCreating || !appId}
            className={`w-full py-3 px-4 rounded-md font-medium transition-colors ${
              isCreating || !appId
                ? 'bg-gray-300 dark:bg-gray-700 text-gray-500 dark:text-gray-400 cursor-not-allowed'
                : dryRun
                ? 'bg-blue-600 hover:bg-blue-700 text-white'
                : 'bg-red-600 hover:bg-red-700 text-white'
            }`}
          >
            {isCreating
              ? 'Starting...'
              : dryRun
              ? '🔍 Preview Delete (Dry Run)'
              : '🗑️ Start Deletion'}
          </button>

          {!dryRun && (
            <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-md p-4">
              <p className="text-sm text-yellow-800 dark:text-yellow-200">
                ⚠️ <strong>Warning:</strong> This operation will permanently delete items from your
                Podio app. This cannot be undone. Consider using dry run mode first to preview what
                will be deleted.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Progress Display */}
      {jobId && jobStatus && (
        <div className="space-y-4">
          <DeleteProgress jobStatus={jobStatus} isActive={isPolling} />

          {/* Reset Button */}
          {(jobStatus.status === 'completed' || jobStatus.status === 'failed') && (
            <button
              onClick={handleReset}
              className="w-full py-2 px-4 bg-gray-600 hover:bg-gray-700 text-white rounded-md font-medium transition-colors"
            >
              Start New Delete
            </button>
          )}
        </div>
      )}

      {/* Info Section */}
      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-md p-4">
        <h3 className="text-sm font-medium text-blue-900 dark:text-blue-200 mb-2">
          How it works:
        </h3>
        <ul className="text-sm text-blue-800 dark:text-blue-300 space-y-1 list-disc list-inside">
          <li>
            <strong>Phase 1 (Detecting):</strong> Fetches all items from the app that match your
            criteria
          </li>
          <li>
            <strong>Phase 2 (Deleting):</strong> Deletes items in batches with progress tracking
          </li>
          <li>Failed deletions are tracked and can be retried</li>
          <li>Progress bars show real-time status for each phase</li>
        </ul>
      </div>
    </div>
  );
}
