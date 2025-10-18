/**
 * Chat domain types for Phase 4 Chat Interface Enhancement
 *
 * Defines strongly typed wrappers around UIMessage, ToolCallPart, and session data
 */

/**
 * Tool call state during its lifecycle
 */
export type ToolCallState =
  | 'pending'      // Tool call initiated
  | 'streaming'    // Tool is executing
  | 'success'      // Tool completed successfully
  | 'error'        // Tool failed with error
  | 'cancelled';   // Tool execution was cancelled

/**
 * Enhanced chat message with metadata
 */
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: string;
  createdAt?: Date;
  toolInvocations?: Array<{
    toolCallId: string;
    toolName: string;
    args: Record<string, unknown>;
    state: ToolCallState;
    result?: unknown;
  }>;
}

/**
 * Tool call part extracted from message
 */
export interface ToolCallPart {
  id: string;
  name: string;
  state: ToolCallState;
  args?: Record<string, unknown>;
  result?: unknown;
  error?: string;
  startTime?: number;
  endTime?: number;
  duration?: number;
}

/**
 * Serialized session data for localStorage
 */
export interface SerializedSession {
  version: number;
  id: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
}

/**
 * Type guard for text message part
 */
export function isTextPart(part: unknown): part is { type: 'text'; text: string } {
  return (
    typeof part === 'object' &&
    part !== null &&
    'type' in part &&
    part.type === 'text' &&
    'text' in part &&
    typeof part.text === 'string'
  );
}

/**
 * Type guard for tool call part
 */
export function isToolCallPart(part: unknown): part is {
  type: 'tool-call';
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
} {
  return (
    typeof part === 'object' &&
    part !== null &&
    'type' in part &&
    part.type === 'tool-call' &&
    'toolCallId' in part &&
    'toolName' in part &&
    'args' in part
  );
}

/**
 * Type guard for tool result part
 */
export function isToolResultPart(part: unknown): part is {
  type: 'tool-result';
  toolCallId: string;
  toolName: string;
  result: unknown;
  isError?: boolean;
} {
  return (
    typeof part === 'object' &&
    part !== null &&
    'type' in part &&
    part.type === 'tool-result' &&
    'toolCallId' in part &&
    'toolName' in part &&
    'result' in part
  );
}

/**
 * Extract tool call parts from a message
 */
export function getToolParts(message: any): ToolCallPart[] {
  // Try toolInvocations first (legacy format)
  if (message.toolInvocations && Array.isArray(message.toolInvocations)) {
    return message.toolInvocations.map((invocation: any) => ({
      id: invocation.toolCallId,
      name: invocation.toolName,
      state: invocation.state as ToolCallState,
      args: invocation.args as Record<string, unknown> | undefined,
      result: 'result' in invocation ? invocation.result : undefined,
    }));
  }

  // Try parts format (AI SDK v5)
  if (message.parts && Array.isArray(message.parts)) {
    const toolParts: ToolCallPart[] = [];
    const toolCalls = new Map<string, ToolCallPart>();

    // Collect tool calls and results
    for (const part of message.parts) {
      if (part.type === 'tool-call') {
        toolCalls.set(part.toolCallId, {
          id: part.toolCallId,
          name: part.toolName,
          state: 'pending',
          args: part.args,
        });
      } else if (part.type === 'tool-result') {
        const existing = toolCalls.get(part.toolCallId);
        if (existing) {
          existing.state = part.isError ? 'error' : 'success';
          existing.result = part.result;
        } else {
          toolCalls.set(part.toolCallId, {
            id: part.toolCallId,
            name: part.toolName,
            state: part.isError ? 'error' : 'success',
            args: undefined,
            result: part.result,
          });
        }
      }
    }

    return Array.from(toolCalls.values());
  }

  return [];
}

/**
 * Format tool value for display (truncate long values)
 */
export function formatToolValue(value: unknown, maxLength = 2000): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';

  try {
    const str = typeof value === 'string' ? value : JSON.stringify(value, null, 2);

    if (str.length <= maxLength) {
      return str;
    }

    return str.slice(0, maxLength) + `... (${str.length - maxLength} more characters)`;
  } catch (error) {
    return '[Unable to format value]';
  }
}

/**
 * Get readable state label
 */
export function getStateLabel(state: ToolCallState): string {
  switch (state) {
    case 'pending':
      return 'Pending';
    case 'streaming':
      return 'Running';
    case 'success':
      return 'Success';
    case 'error':
      return 'Error';
    case 'cancelled':
      return 'Cancelled';
    default:
      return 'Unknown';
  }
}

/**
 * Get state color for badges
 */
export function getStateColor(state: ToolCallState): string {
  switch (state) {
    case 'pending':
      return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200';
    case 'streaming':
      return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200';
    case 'success':
      return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
    case 'error':
      return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200';
    case 'cancelled':
      return 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200';
    default:
      return 'bg-gray-100 text-gray-800';
  }
}
