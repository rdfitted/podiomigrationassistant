/**
 * ToolCallList component for displaying multiple tool calls
 */

'use client';

import React, { useState } from 'react';
import type { ChatMessage } from '@/lib/chat/types';
import { getToolParts } from '@/lib/chat/types';
import { ToolCall } from './ToolCall';

export interface ToolCallListProps {
  message: ChatMessage;
}

/**
 * ToolCallList component for displaying all tool calls in a message
 */
export function ToolCallList({ message }: ToolCallListProps) {
  const [isCollapsed, setIsCollapsed] = useState(true);
  const toolParts = getToolParts(message);

  if (toolParts.length === 0) {
    return null;
  }

  const successCount = toolParts.filter((t) => t.state === 'success').length;
  const errorCount = toolParts.filter((t) => t.state === 'error').length;
  const pendingCount = toolParts.filter(
    (t) => t.state === 'pending' || t.state === 'streaming'
  ).length;

  return (
    <div className="mb-4 rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900/50">
      {/* Header */}
      <div
        className="flex cursor-pointer items-center justify-between p-3 hover:bg-gray-100 dark:hover:bg-gray-800"
        onClick={() => setIsCollapsed(!isCollapsed)}
      >
        <div className="flex items-center gap-3">
          <svg
            className="h-5 w-5 text-gray-600 dark:text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
            />
          </svg>
          <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            Tool Calls ({toolParts.length})
          </span>
        </div>

        <div className="flex items-center gap-3">
          {/* Stats */}
          <div className="flex items-center gap-2 text-xs">
            {successCount > 0 && (
              <span className="rounded-full bg-green-100 px-2 py-0.5 text-green-800 dark:bg-green-900 dark:text-green-200">
                {successCount} success
              </span>
            )}
            {errorCount > 0 && (
              <span className="rounded-full bg-red-100 px-2 py-0.5 text-red-800 dark:bg-red-900 dark:text-red-200">
                {errorCount} error
              </span>
            )}
            {pendingCount > 0 && (
              <span className="rounded-full bg-blue-100 px-2 py-0.5 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                {pendingCount} running
              </span>
            )}
          </div>

          {/* Collapse Icon */}
          <svg
            className={`h-5 w-5 transition-transform ${
              isCollapsed ? '' : 'rotate-180'
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

      {/* Tool Calls */}
      {!isCollapsed && (
        <div className="space-y-2 p-3 pt-0">
          {toolParts.map((toolPart) => (
            <ToolCall key={toolPart.id} toolCall={toolPart} />
          ))}
        </div>
      )}
    </div>
  );
}
