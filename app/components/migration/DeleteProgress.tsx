'use client';

import React from 'react';
import { DeleteJobStatusResponse, DeletePhase } from '@/lib/migration/items/types';

export interface DeleteProgressProps {
  jobStatus: DeleteJobStatusResponse;
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
 * Delete Progress Component
 * Displays real-time progress of delete jobs with phase indicators
 */
export function DeleteProgress({ jobStatus, isActive }: DeleteProgressProps) {
  const { status, phase, progress, phaseStatus, phaseProgress } = jobStatus;

  const statusColors: Record<string, string> = {
    planning: 'bg-gray-200 dark:bg-gray-700',
    in_progress: 'bg-blue-200 dark:bg-blue-900',
    completed: 'bg-green-200 dark:bg-green-900',
    failed: 'bg-red-200 dark:bg-red-900',
    paused: 'bg-yellow-200 dark:bg-yellow-900',
    cancelled: 'bg-gray-200 dark:bg-gray-700',
  };

  const statusTextColors: Record<string, string> = {
    planning: 'text-gray-800 dark:text-gray-200',
    in_progress: 'text-blue-800 dark:text-blue-200',
    completed: 'text-green-800 dark:text-green-200',
    failed: 'text-red-800 dark:text-red-200',
    paused: 'text-yellow-800 dark:text-yellow-200',
    cancelled: 'text-gray-800 dark:text-gray-200',
  };

  const statusIcons: Record<string, string> = {
    planning: '⏳',
    in_progress: '🔄',
    completed: '✅',
    failed: '❌',
    paused: '⏸️',
    cancelled: '🚫',
  };

  const phaseIcons: Record<DeletePhase, string> = {
    detecting: '🔍',
    deleting: '🗑️',
    completed: '✅',
    failed: '❌',
  };

  const phaseColors: Record<DeletePhase, string> = {
    detecting: 'bg-blue-100 dark:bg-blue-900/30 border-blue-300 dark:border-blue-700',
    deleting: 'bg-orange-100 dark:bg-orange-900/30 border-orange-300 dark:border-orange-700',
    completed: 'bg-green-100 dark:bg-green-900/30 border-green-300 dark:border-green-700',
    failed: 'bg-red-100 dark:bg-red-900/30 border-red-300 dark:border-red-700',
  };

  return (
    <div className="space-y-4">
      {/* Status Badge */}
      <div className="flex items-center justify-between">
        <div className={`inline-flex items-center px-3 py-1 rounded-full ${statusColors[status]}`}>
          <span className="mr-2">{statusIcons[status]}</span>
          <span className={`text-sm font-medium ${statusTextColors[status]}`}>
            {status.charAt(0).toUpperCase() + status.slice(1).replace('_', ' ')}
          </span>
        </div>
      </div>

      {/* Phase Indicator */}
      <div className={`border-2 rounded-lg p-4 ${phaseColors[phase]}`}>
        <div className="flex items-center mb-2">
          <span className="text-2xl mr-3">{phaseIcons[phase]}</span>
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
              {phase.charAt(0).toUpperCase() + phase.slice(1)} Phase
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400">{phaseStatus}</p>
          </div>
        </div>

        {/* Phase-specific progress bars */}
        {phase === 'detecting' && phaseProgress?.detecting && (
          <div className="mt-3">
            <div className="flex justify-between text-sm text-gray-600 dark:text-gray-400 mb-2">
              <span>Fetching items...</span>
              <span>
                {phaseProgress.detecting.fetched.toLocaleString()} /{' '}
                {phaseProgress.detecting.estimatedTotal.toLocaleString()}
              </span>
            </div>
            <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3 overflow-hidden">
              <div
                className="h-full transition-all duration-300 bg-blue-600 dark:bg-blue-500"
                style={{ width: `${phaseProgress.detecting.percent}%` }}
              />
            </div>
          </div>
        )}

        {phase === 'deleting' && phaseProgress?.deleting && (
          <div className="mt-3">
            <div className="flex justify-between text-sm text-gray-600 dark:text-gray-400 mb-2">
              <span>Deleting items...</span>
              <span>
                {phaseProgress.deleting.processed.toLocaleString()} /{' '}
                {phaseProgress.deleting.total.toLocaleString()}
              </span>
            </div>
            <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3 overflow-hidden">
              <div
                className="h-full transition-all duration-300 bg-orange-600 dark:bg-orange-500"
                style={{ width: `${phaseProgress.deleting.percent}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Overall Progress Bar */}
      {progress.total > 0 && (
        <div>
          <div className="flex justify-between text-sm text-gray-600 dark:text-gray-400 mb-2">
            <span>Overall Progress</span>
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
          <div className="text-sm text-green-700 dark:text-green-400">Deleted</div>
          <div className="text-2xl font-bold text-green-800 dark:text-green-300">
            {progress.successful.toLocaleString()}
          </div>
        </div>

        <div className="bg-red-50 dark:bg-red-900/20 p-3 rounded-md">
          <div className="text-sm text-red-700 dark:text-red-400">Failed</div>
          <div className="text-2xl font-bold text-red-800 dark:text-red-300">
            {progress.failed.toLocaleString()}
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
              <div className="text-lg font-bold text-blue-900 dark:text-blue-200">
                {jobStatus.throughput.itemsPerSecond.toFixed(1)}
              </div>
            </div>

            <div className="bg-purple-50 dark:bg-purple-900/20 p-2 rounded">
              <div className="text-xs text-purple-700 dark:text-purple-400">Batches/Minute</div>
              <div className="text-lg font-bold text-purple-900 dark:text-purple-200">
                {jobStatus.throughput.batchesPerMinute.toFixed(1)}
              </div>
            </div>

            <div className="bg-indigo-50 dark:bg-indigo-900/20 p-2 rounded">
              <div className="text-xs text-indigo-700 dark:text-indigo-400">
                Avg Batch Duration
              </div>
              <div className="text-lg font-bold text-indigo-900 dark:text-indigo-200">
                {jobStatus.throughput.avgBatchDuration.toFixed(2)}s
              </div>
            </div>

            {jobStatus.throughput.estimatedCompletionTime && (
              <div className="bg-teal-50 dark:bg-teal-900/20 p-2 rounded">
                <div className="text-xs text-teal-700 dark:text-teal-400">ETA</div>
                <div className="text-lg font-bold text-teal-900 dark:text-teal-200">
                  {getTimeRemaining(jobStatus.throughput.estimatedCompletionTime)}
                </div>
              </div>
            )}
          </div>

          {/* Rate Limit Info */}
          {jobStatus.throughput.rateLimitPauses > 0 && (
            <div className="bg-yellow-50 dark:bg-yellow-900/20 p-2 rounded text-sm">
              <span className="text-yellow-700 dark:text-yellow-400">
                ⚠️ Rate limit pauses: {jobStatus.throughput.rateLimitPauses} (
                {(jobStatus.throughput.totalRateLimitDelay / 1000).toFixed(1)}s total delay)
              </span>
            </div>
          )}
        </div>
      )}

      {/* Failed Items Section */}
      {jobStatus.failedItems && jobStatus.failedItems.length > 0 && (
        <div className="mt-4">
          <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-3">
            Failed Items ({jobStatus.failedItems.length})
          </h4>
          <div className="max-h-60 overflow-y-auto space-y-2">
            {jobStatus.failedItems.slice(0, 10).map((item, index) => (
              <div
                key={index}
                className="bg-red-50 dark:bg-red-900/20 p-2 rounded text-sm"
              >
                <div className="flex justify-between">
                  <span className="font-medium text-red-900 dark:text-red-200">
                    Item ID: {item.itemId}
                  </span>
                  <span className="text-xs text-red-700 dark:text-red-400">
                    {new Date(item.timestamp).toLocaleTimeString()}
                  </span>
                </div>
                <div className="text-red-700 dark:text-red-400 mt-1">{item.error}</div>
              </div>
            ))}
            {jobStatus.failedItems.length > 10 && (
              <div className="text-sm text-gray-600 dark:text-gray-400 text-center py-2">
                ... and {jobStatus.failedItems.length - 10} more
              </div>
            )}
          </div>
        </div>
      )}

      {/* Error Summary */}
      {jobStatus.errorsByCategory && Object.keys(jobStatus.errorsByCategory).length > 0 && (
        <div className="mt-4">
          <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-3">
            Error Breakdown
          </h4>
          <div className="space-y-2">
            {Object.entries(jobStatus.errorsByCategory).map(([category, info]) => (
              <div
                key={category}
                className="flex items-center justify-between bg-gray-50 dark:bg-gray-800 p-2 rounded"
              >
                <span className="text-sm text-gray-900 dark:text-white capitalize">
                  {category.replace('_', ' ')}
                </span>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    {info.count} ({info.percentage}%)
                  </span>
                  {info.shouldRetry && (
                    <span className="text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 px-2 py-1 rounded">
                      Retryable
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
