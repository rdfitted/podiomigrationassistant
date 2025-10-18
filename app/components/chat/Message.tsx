/**
 * Message component with timestamp, markdown rendering, and syntax highlighting
 */

'use client';

import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import type { ChatMessage } from '@/lib/chat/types';

export interface MessageProps {
  message: ChatMessage;
}

/**
 * Format timestamp for display
 */
function formatTimestamp(message: ChatMessage): string {
  const date = message.createdAt
    ? new Date(message.createdAt)
    : message.timestamp
      ? new Date(message.timestamp)
      : new Date();

  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/**
 * Extract text content from message
 */
function extractTextContent(message: any): string {
  // If message has a simple content field, use it
  if (typeof message.content === 'string') {
    return message.content;
  }

  // If message has parts (AI SDK v5 format), extract text from parts
  if (message.parts && Array.isArray(message.parts)) {
    return message.parts
      .filter((part: any) => part.type === 'text')
      .map((part: any) => part.text?.trim() || '')
      .filter(Boolean)
      .join('\n\n');
  }

  return '';
}

/**
 * Message component displaying user/assistant messages with markdown support
 */
export function Message({ message }: MessageProps) {
  const isUser = message.role === 'user';
  const timestamp = formatTimestamp(message);
  const content = extractTextContent(message);

  // For assistant messages with no text but tool calls, show a working indicator
  const hasToolCalls = message.role === 'assistant' && (
    (message as any).toolInvocations?.length > 0 ||
    (message as any).parts?.some((p: any) => p.type === 'tool-call')
  );

  // Don't render if no content and no tool calls
  if (!content && !hasToolCalls) {
    return null;
  }

  // If no text content but has tool calls, show working indicator
  if (!content && hasToolCalls) {
    return (
      <div
        className={`mb-4 flex justify-start`}
        data-message-id={message.id}
      >
        <div className="max-w-[80%] rounded-lg px-4 py-3 bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-gray-100">
          <div className="mb-2 flex items-center justify-between gap-3">
            <span className="text-xs font-semibold uppercase opacity-70">
              Agent
            </span>
            <span className="text-xs opacity-60">{timestamp}</span>
          </div>
          <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
            <div className="flex space-x-1">
              <div className="h-2 w-2 animate-bounce rounded-full bg-gray-600 dark:bg-gray-400" style={{ animationDelay: '0ms' }} />
              <div className="h-2 w-2 animate-bounce rounded-full bg-gray-600 dark:bg-gray-400" style={{ animationDelay: '150ms' }} />
              <div className="h-2 w-2 animate-bounce rounded-full bg-gray-600 dark:bg-gray-400" style={{ animationDelay: '300ms' }} />
            </div>
            <span>Working on your request...</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`mb-4 flex ${isUser ? 'justify-end' : 'justify-start'}`}
      data-message-id={message.id}
    >
      <div
        className={`max-w-[80%] rounded-lg px-4 py-3 ${
          isUser
            ? 'bg-blue-600 text-white'
            : 'bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-gray-100'
        }`}
      >
        {/* Message Header */}
        <div className="mb-2 flex items-center justify-between gap-3">
          <span className="text-xs font-semibold uppercase opacity-70">
            {isUser ? 'You' : 'Agent'}
          </span>
          <span className="text-xs opacity-60">{timestamp}</span>
        </div>

        {/* Message Content */}
        <div
          className={`prose max-w-none ${
            isUser
              ? 'prose-invert'
              : 'prose-gray dark:prose-invert'
          }`}
        >
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeHighlight]}
            components={{
              // Customize code block rendering
              code({ node, inline, className, children, ...props }: any) {
                const match = /language-(\w+)/.exec(className || '');
                const language = match ? match[1] : '';

                if (inline) {
                  return (
                    <code
                      className={`${className || ''} rounded bg-black/10 px-1.5 py-0.5 text-sm dark:bg-white/10`}
                      {...props}
                    >
                      {children}
                    </code>
                  );
                }

                return (
                  <div className="relative my-4">
                    {language && (
                      <div className="absolute right-2 top-2 rounded bg-gray-700 px-2 py-1 text-xs text-gray-300">
                        {language}
                      </div>
                    )}
                    <code
                      className={`${className || ''} block overflow-x-auto rounded-lg p-4 text-sm`}
                      {...props}
                    >
                      {children}
                    </code>
                  </div>
                );
              },

              // Customize link rendering
              a({ href, children, ...props }: any) {
                return (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 underline hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                    {...props}
                  >
                    {children}
                  </a>
                );
              },

              // Customize table rendering
              table({ children, ...props }: any) {
                return (
                  <div className="my-4 overflow-x-auto">
                    <table
                      className="min-w-full divide-y divide-gray-300 dark:divide-gray-700"
                      {...props}
                    >
                      {children}
                    </table>
                  </div>
                );
              },
            }}
          >
            {content}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  );
}
