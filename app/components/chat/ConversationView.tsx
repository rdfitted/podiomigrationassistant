/**
 * ConversationView component orchestrating messages and tool calls
 */

'use client';

import React, { useEffect, useRef } from 'react';
import type { ChatMessage } from '@/lib/chat/types';
import { Message } from './Message';
import { ToolCallList } from './ToolCallList';

export interface ConversationViewProps {
  messages: ChatMessage[];
  isLoading: boolean;
  error?: Error | null;
}

/**
 * ConversationView component for displaying the chat transcript
 */
export function ConversationView({
  messages,
  isLoading,
  error,
}: ConversationViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

  return (
    <div
      ref={scrollRef}
      className="h-full overflow-y-auto p-4 space-y-4"
    >
      {/* Empty State */}
      {messages.length === 0 && !isLoading && (
        <div className="flex h-full items-center justify-center">
          <div className="text-center">
            <svg
              className="mx-auto h-12 w-12 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
              />
            </svg>
            <h3 className="mt-4 text-lg font-medium text-gray-900 dark:text-gray-100">
              No messages yet
            </h3>
            <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
              Start a conversation with the Podio Migration Agent
            </p>
          </div>
        </div>
      )}

      {/* Error Banner */}
      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/20">
          <div className="flex items-start">
            <svg
              className="h-5 w-5 text-red-600 dark:text-red-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <div className="ml-3">
              <h3 className="text-sm font-medium text-red-800 dark:text-red-200">
                Error
              </h3>
              <p className="mt-1 text-sm text-red-700 dark:text-red-300">
                {error.message || 'An error occurred'}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Messages */}
      {messages.map((message) => (
        <div key={message.id}>
          <Message message={message} />
          {message.role === 'assistant' && <ToolCallList message={message} />}
        </div>
      ))}

      {/* Loading Indicator */}
      {isLoading && messages.length > 0 && (
        <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
          <div className="flex space-x-1">
            <div className="h-2 w-2 animate-bounce rounded-full bg-gray-600 dark:bg-gray-400" style={{ animationDelay: '0ms' }} />
            <div className="h-2 w-2 animate-bounce rounded-full bg-gray-600 dark:bg-gray-400" style={{ animationDelay: '150ms' }} />
            <div className="h-2 w-2 animate-bounce rounded-full bg-gray-600 dark:bg-gray-400" style={{ animationDelay: '300ms' }} />
          </div>
          <span>Agent is thinking...</span>
        </div>
      )}
    </div>
  );
}
