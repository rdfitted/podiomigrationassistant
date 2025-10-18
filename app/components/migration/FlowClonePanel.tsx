'use client';

import React from 'react';
import { useFlowClone } from '@/app/hooks/useFlowClone';
import { FlowCloneJobStatus } from './FlowCloneJobStatus';

export interface FlowClonePanelProps {
  sourceAppId?: number;
  targetAppId?: number;
}

/**
 * Panel for cloning GlobiFlow automations between apps
 */
export function FlowClonePanel({ sourceAppId, targetAppId }: FlowClonePanelProps) {
  const {
    flows,
    flowsLoading,
    flowsError,
    reloadFlows,
    selectedFlowIds,
    toggleFlowSelection,
    selectAllFlows,
    deselectAllFlows,
    cloning,
    cloneError,
    initiateClone,
    canInitiateClone,
    currentJobId,
    jobStatus,
    clearCurrentJob,
  } = useFlowClone(sourceAppId, targetAppId);

  // Don't render if source or target app not selected
  if (!sourceAppId || !targetAppId) {
    return null;
  }

  return (
    <div className="mt-8 pt-8 border-t border-gray-300 dark:border-gray-700">
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
          Clone GlobiFlow Automations
        </h3>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Select flows to clone from source to destination app
        </p>
      </div>

      {/* Loading state */}
      {flowsLoading && (
        <div className="p-4 text-center text-gray-600 dark:text-gray-400">
          Loading flows...
        </div>
      )}

      {/* Error state */}
      {flowsError && (
        <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md">
          <div className="flex items-start">
            <svg className="w-5 h-5 text-red-600 dark:text-red-400 mt-0.5 mr-3" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
            </svg>
            <div>
              <h4 className="text-sm font-medium text-red-800 dark:text-red-300">Error loading flows</h4>
              <p className="mt-1 text-sm text-red-700 dark:text-red-400">{flowsError}</p>
              <button
                onClick={reloadFlows}
                className="mt-2 text-sm text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300 underline"
              >
                Retry
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Flow list */}
      {!flowsLoading && !flowsError && flows.length === 0 && (
        <div className="p-4 text-center text-gray-600 dark:text-gray-400">
          No flows found for this app
        </div>
      )}

      {!flowsLoading && !flowsError && flows.length > 0 && (
        <div>
          {/* Selection controls */}
          <div className="flex justify-between items-center mb-3">
            <span className="text-sm text-gray-600 dark:text-gray-400">
              {selectedFlowIds.size} of {flows.length} selected
            </span>
            <div className="space-x-2">
              <button
                onClick={selectAllFlows}
                className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
              >
                Select All
              </button>
              <button
                onClick={deselectAllFlows}
                className="text-sm text-gray-600 dark:text-gray-400 hover:underline"
              >
                Clear
              </button>
            </div>
          </div>

          {/* Flow checkboxes */}
          <div className="space-y-2 max-h-64 overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-md p-3">
            {flows.map((flow) => (
              <label
                key={flow.id}
                className="flex items-start space-x-3 p-2 hover:bg-gray-50 dark:hover:bg-gray-800 rounded cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={selectedFlowIds.has(flow.id)}
                  onChange={() => toggleFlowSelection(flow.id)}
                  className="mt-1 h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-900 dark:text-white truncate">
                    {flow.name}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    {flow.triggerType} • {flow.status}
                  </div>
                </div>
              </label>
            ))}
          </div>

          {/* Clone button */}
          <div className="mt-4">
            <button
              onClick={initiateClone}
              disabled={!canInitiateClone || cloning}
              className="w-full px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed disabled:text-gray-500 transition-colors"
            >
              {cloning ? 'Initiating Clone...' : `Clone ${selectedFlowIds.size} Flow${selectedFlowIds.size !== 1 ? 's' : ''}`}
            </button>
          </div>

          {/* Clone error */}
          {cloneError && (
            <div className="mt-3 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md">
              <p className="text-sm text-red-800 dark:text-red-300">{cloneError}</p>
            </div>
          )}
        </div>
      )}

      {/* Job status */}
      {currentJobId && jobStatus && (
        <FlowCloneJobStatus
          jobStatus={jobStatus}
          onClose={clearCurrentJob}
        />
      )}
    </div>
  );
}
