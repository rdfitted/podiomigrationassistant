'use client';

import React from 'react';
import { ItemMigrationStatusResponse } from '@/lib/migration/items/types';
import { FailedItemsSection } from './FailedItemsSection';

export interface ItemMigrationProgressProps {
  jobStatus: ItemMigrationStatusResponse;
  isActive: boolean;
}

/**
 * Helper function to format time remaining
 */
function getTimeRemaining(eta: string): string {
  const now = new Date();
  const etaDate = new Date(eta);
  const diff = etaDate.getTime() - now.getTime();

  if (diff < 0) {
    return 'Completing soon...';
  }

  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((diff % (1000 * 60)) / 1000);

  if (hours > 0) {
    return `${hours}h ${minutes}m remaining`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds}s remaining`;
  } else {
    return `${seconds}s remaining`;
  }
}

/**
 * Item Migration Progress Component
 * Displays real-time progress of item migration jobs
 */
export function ItemMigrationProgress({ jobStatus, isActive }: ItemMigrationProgressProps) {
  const { status, progress, errors } = jobStatus;

  // Calculate actual failed count from failedItems array (source of truth)
  // This handles cases where progress.failed is stale but failedItems is accurate
  const actualFailed = Math.max(
    progress.failed,
    jobStatus.failedItems?.length || 0
  );

  const statusColors: Record<string, string> = {
    planning: 'bg-gray-200 dark:bg-gray-700',
    in_progress: 'bg-blue-200 dark:bg-blue-900',
    completed: 'bg-green-200 dark:bg-green-900',
    failed: 'bg-red-200 dark:bg-red-900',
    paused: 'bg-yellow-200 dark:bg-yellow-900',
  };

  const statusTextColors: Record<string, string> = {
    planning: 'text-gray-800 dark:text-gray-200',
    in_progress: 'text-blue-800 dark:text-blue-200',
    completed: 'text-green-800 dark:text-green-200',
    failed: 'text-red-800 dark:text-red-200',
    paused: 'text-yellow-800 dark:text-yellow-200',
  };

  const statusIcons: Record<string, string> = {
    planning: '⏳',
    in_progress: '🔄',
    completed: '✅',
    failed: '❌',
    paused: '⏸️',
  };

  return (
    <div className="space-y-4">
      {/* Status Badge */}
      <div className={`inline-flex items-center px-3 py-1 rounded-full ${statusColors[status]}`}>
        <span className="mr-2">{statusIcons[status]}</span>
        <span className={`text-sm font-medium ${statusTextColors[status]}`}>
          {status.charAt(0).toUpperCase() + status.slice(1).replace('_', ' ')}
        </span>
      </div>

      {/* Progress Bar */}
      {progress.total > 0 && (
        <div>
          <div className="flex justify-between text-sm text-gray-600 dark:text-gray-400 mb-2">
            <span>Progress</span>
            <span>{progress.percent}%</span>
          </div>
          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3 overflow-hidden">
            <div
              className={`h-full transition-all duration-300 ${
                status === 'completed'
                  ? 'bg-green-600 dark:bg-green-500'
                  : status === 'failed'
                  ? 'bg-red-600 dark:bg-red-500'
                  : 'bg-blue-600 dark:bg-blue-500'
              }`}
              style={{ width: `${progress.percent}%` }}
            />
          </div>
        </div>
      )}

      {/* Statistics Grid */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-gray-50 dark:bg-gray-800 p-3 rounded-md">
          <div className="text-sm text-gray-600 dark:text-gray-400">Total Items</div>
          <div className="text-2xl font-bold text-gray-900 dark:text-white">
            {progress.total.toLocaleString()}
          </div>
        </div>

        <div className="bg-gray-50 dark:bg-gray-800 p-3 rounded-md">
          <div className="text-sm text-gray-600 dark:text-gray-400">Processed</div>
          <div className="text-2xl font-bold text-gray-900 dark:text-white">
            {progress.processed.toLocaleString()}
          </div>
        </div>

        <div className="bg-green-50 dark:bg-green-900/20 p-3 rounded-md">
          <div className="text-sm text-green-700 dark:text-green-400">Successful</div>
          <div className="text-2xl font-bold text-green-800 dark:text-green-300">
            {progress.successful.toLocaleString()}
          </div>
        </div>

        <div className="bg-red-50 dark:bg-red-900/20 p-3 rounded-md">
          <div className="text-sm text-red-700 dark:text-red-400">Failed</div>
          <div className="text-2xl font-bold text-red-800 dark:text-red-300">
            {actualFailed.toLocaleString()}
          </div>
        </div>
      </div>

      {/* Throughput Metrics */}
      {jobStatus.throughput && (
        <div className="mt-4 space-y-3">
          <h4 className="text-sm font-medium text-gray-900 dark:text-white">
            Performance Metrics
          </h4>

          {/* Throughput Stats */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-blue-50 dark:bg-blue-900/20 p-2 rounded">
              <div className="text-xs text-blue-700 dark:text-blue-400">Items/Second</div>
              <div className="text-lg font-bold text-blue-800 dark:text-blue-300">
                {jobStatus.throughput.itemsPerSecond.toFixed(1)}
              </div>
            </div>

            <div className="bg-purple-50 dark:bg-purple-900/20 p-2 rounded">
              <div className="text-xs text-purple-700 dark:text-purple-400">Batches/Minute</div>
              <div className="text-lg font-bold text-purple-800 dark:text-purple-300">
                {jobStatus.throughput.batchesPerMinute.toFixed(1)}
              </div>
            </div>
          </div>

          {/* Average Batch Duration */}
          <div className="bg-gray-50 dark:bg-gray-800 p-2 rounded">
            <div className="text-xs text-gray-600 dark:text-gray-400">Avg Batch Duration</div>
            <div className="text-sm font-medium text-gray-900 dark:text-white">
              {(jobStatus.throughput.avgBatchDuration / 1000).toFixed(1)}s
            </div>
          </div>

          {/* ETA */}
          {jobStatus.throughput.estimatedCompletionTime && status === 'in_progress' && (
            <div className="bg-green-50 dark:bg-green-900/20 p-3 rounded border border-green-200 dark:border-green-800">
              <div className="text-xs text-green-700 dark:text-green-400 mb-1">Estimated Completion</div>
              <div className="text-sm font-bold text-green-800 dark:text-green-300">
                {new Date(jobStatus.throughput.estimatedCompletionTime).toLocaleString()}
              </div>
              <div className="text-xs text-green-600 dark:text-green-500 mt-1">
                {getTimeRemaining(jobStatus.throughput.estimatedCompletionTime)}
              </div>
            </div>
          )}

          {/* Rate Limit Info */}
          {jobStatus.throughput.rateLimitPauses > 0 && (
            <div className="bg-yellow-50 dark:bg-yellow-900/20 p-2 rounded text-xs">
              <div className="text-yellow-700 dark:text-yellow-400">
                Rate limits: {jobStatus.throughput.rateLimitPauses} pauses
                ({(jobStatus.throughput.totalRateLimitDelay / 1000).toFixed(0)}s total delay)
              </div>
            </div>
          )}
        </div>
      )}

      {/* Last Update */}
      <div className="text-xs text-gray-500 dark:text-gray-400">
        Last updated: {new Date(progress.lastUpdate).toLocaleTimeString()}
        {isActive && <span className="ml-2 inline-block w-2 h-2 bg-green-500 rounded-full animate-pulse" />}
      </div>

      {/* Error Categories */}
      {jobStatus.errorsByCategory && Object.keys(jobStatus.errorsByCategory).length > 0 && (
        <div className="mt-4">
          <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-2">
            Error Breakdown
          </h4>
          <div className="space-y-2">
            {Object.entries(jobStatus.errorsByCategory).map(([category, stats]) => {
              const categoryColors: Record<string, string> = {
                network: 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300 border-blue-200 dark:border-blue-800',
                rate_limit: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300 border-yellow-200 dark:border-yellow-800',
                validation: 'bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-300 border-purple-200 dark:border-purple-800',
                permission: 'bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-300 border-orange-200 dark:border-orange-800',
                duplicate: 'bg-pink-100 dark:bg-pink-900/30 text-pink-800 dark:text-pink-300 border-pink-200 dark:border-pink-800',
                unknown: 'bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-300 border-gray-200 dark:border-gray-700',
              };

              const categoryIcons: Record<string, string> = {
                network: '🌐',
                rate_limit: '⏱️',
                validation: '⚠️',
                permission: '🔒',
                duplicate: '📋',
                unknown: '❓',
              };

              const categoryLabels: Record<string, string> = {
                network: 'Network Error',
                rate_limit: 'Rate Limit',
                validation: 'Validation Error',
                permission: 'Permission Denied',
                duplicate: 'Duplicate Item',
                unknown: 'Unknown Error',
              };

              return (
                <div
                  key={category}
                  className={`p-2 border rounded ${categoryColors[category] || categoryColors.unknown}`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center">
                      <span className="mr-2">{categoryIcons[category] || categoryIcons.unknown}</span>
                      <span className="text-sm font-medium">
                        {categoryLabels[category] || category}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold">{stats.count}</span>
                      <span className="text-xs">({stats.percentage}%)</span>
                      {stats.shouldRetry && (
                        <span className="text-xs px-1.5 py-0.5 bg-white/50 dark:bg-black/20 rounded">
                          Will Retry
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Errors List */}
      {errors.length > 0 && (
        <div className="mt-4">
          <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-2">
            Recent Errors ({errors.length})
          </h4>
          <div className="max-h-40 overflow-y-auto space-y-2">
            {errors.slice(0, 5).map((error, index) => (
              <div
                key={index}
                className="p-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded text-sm"
              >
                <div className="text-red-800 dark:text-red-300 font-medium">
                  {error.itemId ? `Item ${error.itemId}` : 'Error'}
                </div>
                <div className="text-red-700 dark:text-red-400 text-xs mt-1">{error.message}</div>
              </div>
            ))}
            {errors.length > 5 && (
              <div className="text-xs text-gray-500 dark:text-gray-400 text-center">
                +{errors.length - 5} more errors
              </div>
            )}
          </div>
        </div>
      )}

      {/* Retry History */}
      {jobStatus.retryAttempts !== undefined && jobStatus.retryAttempts > 0 && (
        <div className="mt-4">
          <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-2">
            Retry History
          </h4>
          <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded p-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-2xl">🔄</span>
                <div>
                  <div className="text-sm font-medium text-orange-800 dark:text-orange-300">
                    Retry Attempt #{jobStatus.retryAttempts}
                  </div>
                  {jobStatus.lastRetryTimestamp && (
                    <div className="text-xs text-orange-700 dark:text-orange-400 mt-1">
                      Last retry: {new Date(jobStatus.lastRetryTimestamp).toLocaleString()}
                    </div>
                  )}
                </div>
              </div>
              <div className="text-right">
                <div className="text-xs text-orange-700 dark:text-orange-400">Total Retries</div>
                <div className="text-2xl font-bold text-orange-800 dark:text-orange-300">
                  {jobStatus.retryAttempts}
                </div>
              </div>
            </div>
            <div className="mt-2 text-xs text-orange-600 dark:text-orange-500">
              💡 Each retry processes only failed items without re-indexing
            </div>

            {/* Previous Run Summary (Snapshot) */}
            {jobStatus.preRetrySnapshot && (
              <details className="mt-3">
                <summary className="cursor-pointer text-xs font-medium text-orange-700 dark:text-orange-400 hover:text-orange-800 dark:hover:text-orange-300">
                  📊 Previous Run Summary
                </summary>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <div className="bg-white/50 dark:bg-black/20 p-2 rounded">
                    <div className="text-xs text-gray-600 dark:text-gray-400">Processed</div>
                    <div className="text-sm font-bold text-gray-900 dark:text-white">
                      {jobStatus.preRetrySnapshot.processed.toLocaleString()}
                    </div>
                  </div>
                  <div className="bg-white/50 dark:bg-black/20 p-2 rounded">
                    <div className="text-xs text-green-700 dark:text-green-400">Successful</div>
                    <div className="text-sm font-bold text-green-800 dark:text-green-300">
                      {jobStatus.preRetrySnapshot.successful.toLocaleString()}
                    </div>
                  </div>
                  <div className="bg-white/50 dark:bg-black/20 p-2 rounded">
                    <div className="text-xs text-red-700 dark:text-red-400">Failed</div>
                    <div className="text-sm font-bold text-red-800 dark:text-red-300">
                      {jobStatus.preRetrySnapshot.failed.toLocaleString()}
                    </div>
                  </div>
                  <div className="bg-white/50 dark:bg-black/20 p-2 rounded">
                    <div className="text-xs text-gray-600 dark:text-gray-400">Progress</div>
                    <div className="text-sm font-bold text-gray-900 dark:text-white">
                      {jobStatus.preRetrySnapshot.percent}%
                    </div>
                  </div>
                </div>
                <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                  Last updated: {new Date(jobStatus.preRetrySnapshot.lastUpdate).toLocaleString()}
                </div>
              </details>
            )}
          </div>
        </div>
      )}

      {/* Failed Items Section */}
      {jobStatus.failedItems && jobStatus.failedItems.length > 0 && (
        <FailedItemsSection
          failedItems={jobStatus.failedItems}
          errorsByCategory={jobStatus.errorsByCategory}
        />
      )}
    </div>
  );
}
