'use client';

import React, { useState } from 'react';

export interface FieldChange {
  fieldExternalId: string;
  fieldLabel?: string;
  currentValue: unknown;
  newValue: unknown;
  willChange: boolean;
}

export interface UpdatePreview {
  sourceItemId: number;
  targetItemId: number;
  matchValue: unknown;
  changes: FieldChange[];
  changeCount: number;
}

export interface CreatePreview {
  sourceItemId: number;
  matchValue: unknown | null;
  fields: Array<{
    fieldExternalId: string;
    fieldLabel?: string;
    value: unknown;
  }>;
  fieldCount: number;
}

export interface DryRunPreviewData {
  mode: 'create' | 'update' | 'upsert';
  // For CREATE and UPSERT modes (UPSERT creates non-duplicates)
  wouldCreate?: CreatePreview[];
  // For UPDATE and UPSERT modes (UPSERT updates duplicates)
  wouldUpdate?: UpdatePreview[];
  // Common to all modes
  wouldFail: Array<{
    sourceItemId: number;
    matchValue?: unknown;
    reason: string;
  }>;
  wouldSkip: Array<{
    sourceItemId: number;
    targetItemId?: number;
    matchValue?: unknown;
    reason: string;
  }>;
  summary: {
    totalSourceItems: number;
    wouldCreateCount?: number;
    wouldUpdateCount?: number;
    wouldFailCount: number;
    wouldSkipCount: number;
    totalFieldChanges?: number;
  };
}

export interface DryRunPreviewProps {
  preview: DryRunPreviewData;
  onExecute?: () => void;
  onReset?: () => void;
}

/**
 * Dry-Run Preview Component
 * Displays detailed preview of what would change in UPDATE mode
 */
export function DryRunPreview({ preview, onExecute, onReset }: DryRunPreviewProps) {
  const [expandedItems, setExpandedItems] = useState<Set<number>>(new Set());

  // Determine initial tab based on mode and available data
  const getInitialTab = (): 'create' | 'update' | 'fail' | 'skip' => {
    if (preview.mode === 'create') return 'create';
    if (preview.mode === 'update') return 'update';
    // For UPSERT, default to 'create' if there are items to create, else 'update'
    if (preview.mode === 'upsert') {
      return (preview.summary.wouldCreateCount ?? 0) > 0 ? 'create' : 'update';
    }
    return 'update';
  };

  const [activeTab, setActiveTab] = useState<'create' | 'update' | 'fail' | 'skip'>(getInitialTab());

  const { summary, mode } = preview;

  const toggleItemExpanded = (itemId: number) => {
    const newExpanded = new Set(expandedItems);
    if (newExpanded.has(itemId)) {
      newExpanded.delete(itemId);
    } else {
      newExpanded.add(itemId);
    }
    setExpandedItems(newExpanded);
  };

  const formatValue = (value: unknown): string => {
    if (value === null || value === undefined) return '(empty)';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  };

  return (
    <div className="space-y-6">
      {/* Summary Header */}
      <div className="bg-gradient-to-r from-blue-50 to-green-50 dark:from-blue-900/20 dark:to-green-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center">
              🔍 Dry-Run Preview Results
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              Preview generated - no changes have been made
            </p>
          </div>
          <div className="flex gap-2">
            {onReset && (
              <button
                onClick={onReset}
                className="px-4 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-900 dark:text-white rounded-md font-medium transition-colors"
              >
                Reset
              </button>
            )}
            {onExecute && ((mode === 'create' && (summary.wouldCreateCount || 0) > 0) || (mode !== 'create' && (summary.wouldUpdateCount || 0) > 0)) && (
              <button
                onClick={onExecute}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md font-medium transition-colors"
              >
                {mode === 'create' ? (
                  <>✓ Execute Creates ({summary.wouldCreateCount} items)</>
                ) : (
                  <>✓ Execute Updates ({summary.wouldUpdateCount} items)</>
                )}
              </button>
            )}
          </div>
        </div>

        {/* Summary Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white dark:bg-gray-800 rounded-md p-4 border border-gray-200 dark:border-gray-700">
            <div className="text-2xl font-bold text-gray-900 dark:text-white">
              {summary.totalSourceItems}
            </div>
            <div className="text-sm text-gray-600 dark:text-gray-400">Total Items</div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-md p-4 border border-green-200 dark:border-green-700">
            <div className="text-2xl font-bold text-green-600 dark:text-green-400">
              {mode === 'create' ? summary.wouldCreateCount : summary.wouldUpdateCount}
            </div>
            <div className="text-sm text-gray-600 dark:text-gray-400">
              {mode === 'create' ? 'Would Create' : 'Would Update'}
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-md p-4 border border-red-200 dark:border-red-700">
            <div className="text-2xl font-bold text-red-600 dark:text-red-400">
              {summary.wouldFailCount}
            </div>
            <div className="text-sm text-gray-600 dark:text-gray-400">Would Fail</div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-md p-4 border border-gray-200 dark:border-gray-700">
            <div className="text-2xl font-bold text-gray-600 dark:text-gray-400">
              {summary.wouldSkipCount}
            </div>
            <div className="text-sm text-gray-600 dark:text-gray-400">Would Skip</div>
          </div>
        </div>

        {mode === 'create' && (summary.wouldCreateCount || 0) > 0 && (
          <div className="mt-4 text-sm text-gray-700 dark:text-gray-300">
            <strong>{summary.wouldCreateCount}</strong> items would be created
          </div>
        )}
        {mode !== 'create' && (summary.wouldUpdateCount || 0) > 0 && summary.totalFieldChanges !== undefined && (
          <div className="mt-4 text-sm text-gray-700 dark:text-gray-300">
            <strong>{summary.totalFieldChanges}</strong> total field changes across {summary.wouldUpdateCount} items
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 dark:border-gray-700">
        <nav className="-mb-px flex space-x-8">
          {/* Show CREATE tab for CREATE and UPSERT modes */}
          {(mode === 'create' || mode === 'upsert') && (
            <button
              onClick={() => setActiveTab('create')}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'create'
                  ? 'border-green-500 text-green-600 dark:text-green-400'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300'
              }`}
            >
              Would Create ({summary.wouldCreateCount || 0})
            </button>
          )}
          {/* Show UPDATE tab for UPDATE and UPSERT modes */}
          {(mode === 'update' || mode === 'upsert') && (
            <button
              onClick={() => setActiveTab('update')}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'update'
                  ? 'border-green-500 text-green-600 dark:text-green-400'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300'
              }`}
            >
              Would Update ({summary.wouldUpdateCount || 0})
            </button>
          )}
          <button
            onClick={() => setActiveTab('fail')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'fail'
                ? 'border-red-500 text-red-600 dark:text-red-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300'
            }`}
          >
            Would Fail ({summary.wouldFailCount})
          </button>
          <button
            onClick={() => setActiveTab('skip')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'skip'
                ? 'border-gray-500 text-gray-600 dark:text-gray-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300'
            }`}
          >
            Would Skip ({summary.wouldSkipCount})
          </button>
        </nav>
      </div>

      {/* Tab Content */}
      <div className="space-y-4">
        {/* Would Create Tab */}
        {activeTab === 'create' && (
          <div className="space-y-3">
            {(!preview.wouldCreate || preview.wouldCreate.length === 0) ? (
              <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                No items would be created
              </div>
            ) : (
              preview.wouldCreate.map((item) => (
                <div
                  key={item.sourceItemId}
                  className="border border-green-200 dark:border-green-700 rounded-md bg-white dark:bg-gray-800"
                >
                  <button
                    onClick={() => toggleItemExpanded(item.sourceItemId)}
                    className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-gray-50 dark:hover:bg-gray-700"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-green-600 dark:text-green-400">+</span>
                      <div>
                        <div className="text-sm font-medium text-gray-900 dark:text-white">
                          Source Item #{item.sourceItemId} → New Item
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">
                          {item.matchValue && <>Match: {formatValue(item.matchValue)} • </>}
                          {item.fieldCount} field{item.fieldCount !== 1 ? 's' : ''}
                        </div>
                      </div>
                    </div>
                    <svg
                      className={`w-5 h-5 transition-transform ${expandedItems.has(item.sourceItemId) ? 'rotate-180' : ''}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>

                  {expandedItems.has(item.sourceItemId) && (
                    <div className="px-4 py-3 border-t border-green-100 dark:border-green-800 bg-gray-50 dark:bg-gray-900/50">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-xs text-gray-500 dark:text-gray-400">
                            <th className="pb-2 pr-4">Field</th>
                            <th className="pb-2">Value</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                          {item.fields.map((field) => (
                            <tr key={field.fieldExternalId} className="text-gray-900 dark:text-gray-100">
                              <td className="py-2 pr-4 font-medium">{field.fieldLabel || field.fieldExternalId}</td>
                              <td className="py-2 font-mono text-xs text-green-600 dark:text-green-400">
                                {formatValue(field.value)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {/* Would Update Tab */}
        {activeTab === 'update' && (
          <div className="space-y-3">
            {(!preview.wouldUpdate || preview.wouldUpdate.length === 0) ? (
              <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                No items would be updated
              </div>
            ) : (
              preview.wouldUpdate.map((item) => (
                <div
                  key={item.sourceItemId}
                  className="border border-green-200 dark:border-green-700 rounded-md bg-white dark:bg-gray-800"
                >
                  <button
                    onClick={() => toggleItemExpanded(item.sourceItemId)}
                    className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-gray-50 dark:hover:bg-gray-700"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-green-600 dark:text-green-400">✓</span>
                      <div>
                        <div className="text-sm font-medium text-gray-900 dark:text-white">
                          Source Item #{item.sourceItemId} → Target Item #{item.targetItemId}
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">
                          Match: {formatValue(item.matchValue)} • {item.changeCount} field{item.changeCount !== 1 ? 's' : ''} will change
                        </div>
                      </div>
                    </div>
                    <svg
                      className={`w-5 h-5 transition-transform ${expandedItems.has(item.sourceItemId) ? 'rotate-180' : ''}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>

                  {expandedItems.has(item.sourceItemId) && (
                    <div className="px-4 py-3 border-t border-green-100 dark:border-green-800 bg-gray-50 dark:bg-gray-900/50">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-xs text-gray-500 dark:text-gray-400">
                            <th className="pb-2 pr-4">Field</th>
                            <th className="pb-2 pr-4">Current Value</th>
                            <th className="pb-2 pr-4">New Value</th>
                            <th className="pb-2">Change</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                          {item.changes.filter(c => c.willChange).map((change) => (
                            <tr key={change.fieldExternalId} className="text-gray-900 dark:text-gray-100">
                              <td className="py-2 pr-4 font-medium">{change.fieldLabel || change.fieldExternalId}</td>
                              <td className="py-2 pr-4 font-mono text-xs text-red-600 dark:text-red-400">
                                {formatValue(change.currentValue)}
                              </td>
                              <td className="py-2 pr-4 font-mono text-xs text-green-600 dark:text-green-400">
                                {formatValue(change.newValue)}
                              </td>
                              <td className="py-2">
                                <span className="text-xs bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200 px-2 py-0.5 rounded">
                                  Will Change
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {/* Would Fail Tab */}
        {activeTab === 'fail' && (
          <div className="space-y-3">
            {preview.wouldFail.length === 0 ? (
              <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                No items would fail - all source items have matching targets
              </div>
            ) : (
              preview.wouldFail.map((item, idx) => (
                <div
                  key={idx}
                  className="border border-red-200 dark:border-red-700 rounded-md bg-white dark:bg-gray-800 px-4 py-3"
                >
                  <div className="flex items-start gap-3">
                    <span className="text-red-600 dark:text-red-400 text-xl">✗</span>
                    <div>
                      <div className="text-sm font-medium text-gray-900 dark:text-white">
                        Source Item #{item.sourceItemId}
                      </div>
                      <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                        Match Value: {formatValue(item.matchValue)}
                      </div>
                      <div className="text-xs text-red-600 dark:text-red-400 mt-1">
                        {item.reason}
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* Would Skip Tab */}
        {activeTab === 'skip' && (
          <div className="space-y-3">
            {preview.wouldSkip.length === 0 ? (
              <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                No items would be skipped - all matched items have changes
              </div>
            ) : (
              preview.wouldSkip.map((item, idx) => (
                <div
                  key={idx}
                  className="border border-gray-200 dark:border-gray-700 rounded-md bg-white dark:bg-gray-800 px-4 py-3"
                >
                  <div className="flex items-start gap-3">
                    <span className="text-gray-600 dark:text-gray-400 text-xl">⏭️</span>
                    <div>
                      <div className="text-sm font-medium text-gray-900 dark:text-white">
                        {typeof item.targetItemId === 'number' ? (
                          <>Source Item #{item.sourceItemId} → Target Item #{item.targetItemId}</>
                        ) : (
                          <>Source Item #{item.sourceItemId}</>
                        )}
                      </div>
                      <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                        Match Value: {formatValue(item.matchValue)}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        {item.reason}
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
