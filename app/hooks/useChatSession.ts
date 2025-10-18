/**
 * Custom hook for chat session management with localStorage persistence
 *
 * Wraps useChat hook and adds autosave, restore, clear, and export functionality
 */

'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import type { ChatMessage } from '@/lib/chat/types';
import {
  loadSession,
  saveSession,
  clearSession,
  exportSessionToJSON,
  exportSessionToMarkdown,
} from '@/lib/storage/chatSession';

export interface UseChatSessionOptions {
  sessionId?: string;
  autosaveDelay?: number;
  onRestore?: (messageCount: number) => void;
  onSave?: () => void;
  onClear?: () => void;
}

export interface UseChatSessionReturn {
  messages: ChatMessage[];
  input: string;
  setInput: (value: string) => void;
  handleSubmit: (e: React.FormEvent) => void;
  isLoading: boolean;
  error: Error | undefined;
  restoreSession: () => void;
  clearChatSession: () => void;
  exportSession: (format: 'json' | 'markdown') => void;
  sessionId: string;
}

/**
 * Hook for managing chat sessions with localStorage persistence
 */
export function useChatSession(
  options: UseChatSessionOptions = {}
): UseChatSessionReturn {
  const {
    sessionId = 'default',
    autosaveDelay = 1000,
    onRestore,
    onSave,
    onClear,
  } = options;

  // Initialize useChat hook
  const {
    messages,
    sendMessage,
    setMessages,
    status,
    error,
  } = useChat({
    transport: new DefaultChatTransport({
      api: '/api/agent',
    }),
  });

  // Local state for input
  const [input, setInput] = useState('');

  // Derived state
  const isLoading = status === 'submitted' || status === 'streaming';

  // Track if session has been restored
  const hasRestoredRef = useRef(false);

  // Autosave timer ref
  const autosaveTimerRef = useRef<NodeJS.Timeout | null>(null);

  /**
   * Restore session from localStorage on mount
   */
  const restoreSession = useCallback(() => {
    if (typeof window === 'undefined') return;

    const session = loadSession(sessionId);
    if (!session || session.messages.length === 0) return;

    // Add timestamps to restored messages if missing
    const messagesWithTimestamps = session.messages.map((msg) => ({
      ...msg,
      createdAt: msg.createdAt ? new Date(msg.createdAt) : new Date(),
      timestamp: msg.timestamp || new Date().toISOString(),
    }));

    setMessages(messagesWithTimestamps as any);
    onRestore?.(session.messages.length);
  }, [sessionId, setMessages, onRestore]);

  /**
   * Save current messages to localStorage
   */
  const saveChatSession = useCallback(() => {
    if (typeof window === 'undefined' || messages.length === 0) return;

    // Add timestamps to messages if missing
    const messagesWithTimestamps = messages.map((msg: any) => ({
      ...msg,
      timestamp: msg.timestamp || new Date().toISOString(),
      createdAt: msg.createdAt || new Date(),
    }));

    const success = saveSession(sessionId, messagesWithTimestamps as ChatMessage[]);
    if (success) {
      onSave?.();
    }
  }, [sessionId, messages, onSave]);

  /**
   * Clear chat session
   */
  const clearChatSession = useCallback(() => {
    clearSession(sessionId);
    setMessages([]);
    setInput('');
    onClear?.();
  }, [sessionId, setMessages, onClear]);

  /**
   * Export session to file
   */
  const exportSession = useCallback(
    (format: 'json' | 'markdown') => {
      const blob =
        format === 'json'
          ? exportSessionToJSON(sessionId)
          : exportSessionToMarkdown(sessionId);

      if (!blob) {
        console.error('[useChatSession] Failed to export session');
        return;
      }

      // Create download link
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `podio-agent-chat-${sessionId}-${Date.now()}.${
        format === 'json' ? 'json' : 'md'
      }`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    },
    [sessionId]
  );

  /**
   * Handle form submission
   */
  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();

      const trimmed = input.trim();
      if (!trimmed || isLoading) return;

      try {
        await sendMessage({ text: trimmed });
        setInput('');
      } catch (error) {
        console.error('[useChatSession] Failed to send message:', error);
      }
    },
    [input, isLoading, sendMessage]
  );

  /**
   * Restore session on mount
   */
  useEffect(() => {
    if (!hasRestoredRef.current) {
      restoreSession();
      hasRestoredRef.current = true;
    }
  }, [restoreSession]);

  /**
   * Autosave messages when they change
   */
  useEffect(() => {
    // Don't autosave if loading or no messages
    if (isLoading || messages.length === 0) return;

    // Clear existing timer
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
    }

    // Set new timer
    autosaveTimerRef.current = setTimeout(() => {
      saveChatSession();
    }, autosaveDelay);

    // Cleanup
    return () => {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
      }
    };
  }, [messages, isLoading, autosaveDelay, saveChatSession]);

  return {
    messages: messages as any as ChatMessage[],
    input,
    setInput,
    handleSubmit,
    isLoading,
    error,
    restoreSession,
    clearChatSession,
    exportSession,
    sessionId,
  };
}
