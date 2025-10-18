/**
 * ToolCall component for displaying individual tool call details
 */

'use client';

import React, { useState } from 'react';
import type { ToolCallPart } from '@/lib/chat/types';
import { formatToolValue, getStateLabel, getStateColor } from '@/lib/chat/types';

export interface ToolCallProps {
  toolCall: ToolCallPart;
}

/**
 * ToolCall component showing name, status, arguments, results, and errors
 */
export function ToolCall({ toolCall }: ToolCallProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showFullArgs, setShowFullArgs] = useState(false);
  const [showFullResult, setShowFullResult] = useState(false);

  const stateLabel = getStateLabel(toolCall.state);
  const stateColor = getStateColor(toolCall.state);

  const hasArgs = toolCall.args && Object.keys(toolCall.args).length > 0;
  const hasResult = toolCall.result !== undefined;
  const hasError = toolCall.error !== undefined;
  const isLoading = toolCall.state === 'pending' || toolCall.state === 'streaming';

  return (
    <div className="rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
      {/* Header */}
      <div
        className="flex cursor-pointer items-center justify-between p-3 hover:bg-gray-50 dark:hover:bg-gray-800"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-3">
          <span className="font-mono text-sm font-medium text-gray-900 dark:text-gray-100">
            {toolCall.name}
          </span>
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${stateColor}`}
          >
            {stateLabel}
          </span>
          {isLoading && (
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-blue-600" />
          )}
        </div>

        <div className="flex items-center gap-2">
          {toolCall.duration !== undefined && (
            <span className="text-xs text-gray-500">
              {toolCall.duration}ms
            </span>
          )}
          <svg
            className={`h-5 w-5 transition-transform ${
              isExpanded ? 'rotate-180' : ''
            }`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </div>
      </div>

      {/* Expanded Content */}
      {isExpanded && (
        <div className="border-t border-gray-200 p-3 dark:border-gray-700">
          {/* Arguments */}
          {hasArgs && (
            <div className="mb-3">
              <div className="mb-1 flex items-center justify-between">
                <h4 className="text-xs font-semibold uppercase text-gray-600 dark:text-gray-400">
                  Arguments
                </h4>
                {formatToolValue(toolCall.args, Infinity).length > 2000 && (
                  <button
                    onClick={() => setShowFullArgs(!showFullArgs)}
                    className="text-xs text-blue-600 hover:underline dark:text-blue-400"
                  >
                    {showFullArgs ? 'Show Less' : 'Show More'}
                  </button>
                )}
              </div>
              <pre className="overflow-x-auto rounded bg-gray-100 p-2 text-xs dark:bg-gray-800">
                <code>
                  {showFullArgs
                    ? formatToolValue(toolCall.args, Infinity)
                    : formatToolValue(toolCall.args)}
                </code>
              </pre>
            </div>
          )}

          {/* Result */}
          {hasResult && !hasError && (
            <div className="mb-3">
              <div className="mb-1 flex items-center justify-between">
                <h4 className="text-xs font-semibold uppercase text-gray-600 dark:text-gray-400">
                  Result
                </h4>
                {formatToolValue(toolCall.result, Infinity).length > 2000 && (
                  <button
                    onClick={() => setShowFullResult(!showFullResult)}
                    className="text-xs text-blue-600 hover:underline dark:text-blue-400"
                  >
                    {showFullResult ? 'Show Less' : 'Show More'}
                  </button>
                )}
              </div>
              <pre className="overflow-x-auto rounded bg-gray-100 p-2 text-xs dark:bg-gray-800">
                <code>
                  {showFullResult
                    ? formatToolValue(toolCall.result, Infinity)
                    : formatToolValue(toolCall.result)}
                </code>
              </pre>
            </div>
          )}

          {/* Error */}
          {hasError && (
            <div className="mb-3">
              <h4 className="mb-1 text-xs font-semibold uppercase text-red-600 dark:text-red-400">
                Error
              </h4>
              <div className="rounded bg-red-50 p-2 text-xs text-red-900 dark:bg-red-900/20 dark:text-red-200">
                {toolCall.error}
              </div>
            </div>
          )}

          {/* Loading Skeleton */}
          {isLoading && !hasResult && !hasError && (
            <div className="space-y-2">
              <div className="h-4 w-3/4 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
              <div className="h-4 w-1/2 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
