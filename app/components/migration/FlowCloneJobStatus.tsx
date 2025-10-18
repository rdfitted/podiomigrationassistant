'use client';

import React from 'react';
import { FlowCloneJobStatusResponse } from '@/lib/globiflow/types';

export interface FlowCloneJobStatusProps {
  jobStatus: FlowCloneJobStatusResponse;
  onClose?: () => void;
}

/**
 * Component to display flow clone job status and progress
 */
export function FlowCloneJobStatus({ jobStatus, onClose }: FlowCloneJobStatusProps) {
  const { status, progress, steps } = jobStatus;

  const isComplete = status === 'completed' || status === 'failed';
  const progressPercent = progress.total > 0
    ? Math.round(((progress.completed + progress.failed) / progress.total) * 100)
    : 0;

  return (
    <div className="mt-6 border border-gray-300 dark:border-gray-700 rounded-md overflow-hidden">
      {/* Header */}
      <div className="bg-gray-50 dark:bg-gray-800 px-4 py-3 border-b border-gray-300 dark:border-gray-700 flex justify-between items-center">
        <div>
          <h4 className="text-sm font-semibold text-gray-900 dark:text-white">
            Flow Clone Job
          </h4>
          <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">
            {progress.completed} completed • {progress.failed} failed • {progress.total - progress.completed - progress.failed} remaining
          </p>
        </div>
        {onClose && isComplete && (
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Progress bar */}
      <div className="p-4 bg-white dark:bg-gray-900">
        <div className="mb-3">
          <div className="flex justify-between text-xs text-gray-600 dark:text-gray-400 mb-1">
            <span className="capitalize">{status.replace('_', ' ')}</span>
            <span>{progressPercent}%</span>
          </div>
          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2 overflow-hidden">
            <div
              className={`h-full transition-all duration-300 ${
                status === 'failed'
                  ? 'bg-red-600'
                  : status === 'completed'
                  ? 'bg-green-600'
                  : 'bg-blue-600'
              }`}
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>

        {/* Status message */}
        {status === 'completed' && progress.failed === 0 && (
          <div className="mb-3 p-2 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded text-sm text-green-800 dark:text-green-300">
            All flows cloned successfully!
          </div>
        )}

        {status === 'completed' && progress.failed > 0 && (
          <div className="mb-3 p-2 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded text-sm text-yellow-800 dark:text-yellow-300">
            Cloning completed with {progress.failed} error{progress.failed !== 1 ? 's' : ''}
          </div>
        )}

        {status === 'failed' && (
          <div className="mb-3 p-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded text-sm text-red-800 dark:text-red-300">
            Job failed: {jobStatus.error || 'Unknown error'}
          </div>
        )}

        {/* Steps list */}
        <div className="space-y-1 max-h-48 overflow-y-auto">
          {steps.map((step) => (
            <div
              key={step.id}
              className={`flex items-center space-x-2 p-2 rounded text-sm ${
                step.status === 'completed'
                  ? 'bg-green-50 dark:bg-green-900/10'
                  : step.status === 'failed'
                  ? 'bg-red-50 dark:bg-red-900/10'
                  : step.status === 'in_progress'
                  ? 'bg-blue-50 dark:bg-blue-900/10'
                  : 'bg-gray-50 dark:bg-gray-800'
              }`}
            >
              {/* Status icon */}
              {step.status === 'completed' && (
                <svg className="w-4 h-4 text-green-600 dark:text-green-400 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
              )}
              {step.status === 'failed' && (
                <svg className="w-4 h-4 text-red-600 dark:text-red-400 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                </svg>
              )}
              {step.status === 'in_progress' && (
                <svg className="w-4 h-4 text-blue-600 dark:text-blue-400 flex-shrink-0 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
              )}
              {step.status === 'pending' && (
                <svg className="w-4 h-4 text-gray-400 dark:text-gray-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
                </svg>
              )}

              {/* Flow info */}
              <div className="flex-1 min-w-0">
                <div className="text-gray-900 dark:text-white truncate">
                  {step.flowName || step.flowId}
                </div>
                {step.error && (
                  <div className="text-xs text-red-600 dark:text-red-400 truncate">
                    {step.error.message}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
