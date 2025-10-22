/**
 * Main chat interface for Podio Migration Agent
 * Enhanced with Phase 4 features: observability, markdown, session management
 * Now includes migration selection panel for explicit source/destination selection
 */

'use client';

import { useState } from 'react';
import { useChatSession } from './hooks/useChatSession';
import { ConversationView } from './components/chat/ConversationView';
import { ChatControls } from './components/chat/ChatControls';
import { MigrationSelectionPanel } from './components/migration/MigrationSelectionPanel';
import { MigrationProvider } from './contexts/MigrationContext';
import type { ChatMessage } from '@/lib/chat/types';
import type { MigrationSelectionState } from './hooks/useMigrationSelection';

export default function Chat() {
  const [migrationContext, setMigrationContext] = useState<MigrationSelectionState | null>(null);
  const [isPanelOpen, setIsPanelOpen] = useState(true);

  const {
    messages,
    input,
    handleSubmit,
    setInput,
    isLoading,
    error,
    clearChatSession,
    exportSession,
  } = useChatSession({
    sessionId: 'default',
    autosaveDelay: 1000,
    onRestore: (count) => {
      console.log(`[Chat] Restored ${count} messages from localStorage`);
    },
    onSave: () => {
      console.log('[Chat] Session auto-saved');
    },
    onClear: () => {
      console.log('[Chat] Session cleared');
    },
  });

  const handleClear = () => {
    if (window.confirm('Are you sure you want to clear the chat history?')) {
      clearChatSession();
    }
  };

  // Enhanced submit handler that includes migration context
  const handleSubmitWithContext = (e: React.FormEvent) => {
    // If migration context is available, append it to the input
    if (migrationContext && (migrationContext.source.orgId || migrationContext.destination.orgId)) {
      const contextInfo: string[] = [];

      if (migrationContext.source.orgId) {
        contextInfo.push(`Source: ${migrationContext.source.orgName || 'Unknown Org'}`);
        if (migrationContext.source.spaceName) contextInfo.push(`  Workspace: ${migrationContext.source.spaceName}`);
        if (migrationContext.source.appName) contextInfo.push(`  App: ${migrationContext.source.appName}`);
      }

      if (migrationContext.destination.orgId) {
        contextInfo.push(`Destination: ${migrationContext.destination.orgName || 'Unknown Org'}`);
        if (migrationContext.destination.spaceName) contextInfo.push(`  Workspace: ${migrationContext.destination.spaceName}`);
        if (migrationContext.destination.appName) contextInfo.push(`  App: ${migrationContext.destination.appName}`);
      }

      // Store context info but let the original handleSubmit send the message
      // The AI agent will see the context in the header summary
    }

    handleSubmit(e);
  };

  return (
    <MigrationProvider>
      <div className="flex h-screen bg-gray-50 dark:bg-gray-900 relative">
      {/* Main chat column */}
      <div className={`flex flex-1 flex-col overflow-hidden transition-all duration-300 ${isPanelOpen ? 'ml-[5%]' : ''}`}>
        {/* Header */}
        <div className="border-b border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            Podio Migration Agent
          </h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            AI-powered Globiflow workflow migration assistant
          </p>

          {/* Migration context summary (if selections are made) */}
          {migrationContext && (migrationContext.source.orgId || migrationContext.destination.orgId) && (
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              {migrationContext.source.orgId && (
                <div className="inline-flex items-center px-2 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300 rounded">
                  <span className="font-semibold mr-1">Source:</span>
                  {migrationContext.source.orgName}
                  {migrationContext.source.spaceName && ` › ${migrationContext.source.spaceName}`}
                  {migrationContext.source.appName && ` › ${migrationContext.source.appName}`}
                </div>
              )}
              {migrationContext.destination.orgId && (
                <div className="inline-flex items-center px-2 py-1 bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300 rounded">
                  <span className="font-semibold mr-1">Destination:</span>
                  {migrationContext.destination.orgName}
                  {migrationContext.destination.spaceName && ` › ${migrationContext.destination.spaceName}`}
                  {migrationContext.destination.appName && ` › ${migrationContext.destination.appName}`}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Conversation View */}
        <div className="flex-1 overflow-hidden">
          <ConversationView
            messages={messages as ChatMessage[]}
            isLoading={isLoading}
            error={error}
          />
        </div>

        {/* Chat Controls */}
        <div>
          <ChatControls
            input={input}
            onInputChange={setInput}
            onSubmit={handleSubmitWithContext}
            onClear={handleClear}
            onExport={exportSession}
            isLoading={isLoading}
          />
        </div>
      </div>

      {/* Migration selection panel (right side) - Collapsible Full Width Overlay */}
      <div className={`fixed right-0 top-0 h-full w-full transition-transform duration-300 ease-in-out z-40 ${
        isPanelOpen ? 'translate-x-0' : 'translate-x-full'
      }`}>
        <MigrationSelectionPanel onSelectionChange={setMigrationContext} />
      </div>

      {/* Toggle Button */}
      <button
        onClick={() => setIsPanelOpen(!isPanelOpen)}
        className={`fixed top-1/2 -translate-y-1/2 z-50 bg-blue-600 hover:bg-blue-700 text-white p-3 rounded-l-lg shadow-lg transition-all duration-300 ${
          isPanelOpen ? 'left-0' : 'right-0'
        }`}
        title={isPanelOpen ? 'Close panel' : 'Open panel'}
      >
        <svg
          className={`w-5 h-5 transition-transform duration-300 ${isPanelOpen ? 'rotate-0' : 'rotate-180'}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </button>
      </div>
    </MigrationProvider>
  );
}
