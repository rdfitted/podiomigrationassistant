'use client';

import React, { useState } from 'react';
import { FailedItemRecord } from '@/lib/migration/items/types';
import { ErrorCategoryStats } from './ErrorCategoryStats';

export interface FailedItemsSectionProps {
  failedItems?: FailedItemRecord[];
  errorsByCategory?: Record<string, {
    count: number;
    percentage: number;
    shouldRetry: boolean;
  }>;
}

/**
 * Failed Items Section Component
 * Displays a collapsible list of failed items with error details
 */
export function FailedItemsSection({ failedItems, errorsByCategory }: FailedItemsSectionProps) {
  const [isExpanded, setIsExpanded] = useState(() => {
    // Auto-expand if there are >= 10 failures, otherwise collapsed by default
    return failedItems && failedItems.length >= 10;
  });
  const [searchTerm, setSearchTerm] = useState('');

  if (!failedItems || failedItems.length === 0) {
    return null;
  }

  // Filter failed items based on search term
  const filteredItems = searchTerm
    ? failedItems.filter(item =>
        item.sourceItemId.toString().includes(searchTerm) ||
        item.error.toLowerCase().includes(searchTerm.toLowerCase())
      )
    : failedItems;

  return (
    <div className="mt-4 border border-red-200 dark:border-red-800 rounded-md">
      {/* Header - Always visible */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-4 py-3 flex items-center justify-between bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors rounded-t-md"
        type="button"
        aria-expanded={isExpanded}
        aria-controls="failed-items-content"
      >
        <div className="flex items-center gap-2">
          <span className="text-xl">❌</span>
          <span className="font-medium text-red-800 dark:text-red-300">
            Failed Items ({failedItems.length})
          </span>
        </div>
        <svg
          className={`w-5 h-5 text-red-600 dark:text-red-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Content - Collapsible */}
      {isExpanded && (
        <div
          id="failed-items-content"
          className="p-4 bg-white dark:bg-gray-900 border-t border-red-200 dark:border-red-800"
        >
          {/* Error Category Stats */}
          {errorsByCategory && Object.keys(errorsByCategory).length > 0 && (
            <div className="mb-4">
              <ErrorCategoryStats categories={errorsByCategory} />
            </div>
          )}

          {/* Search/Filter */}
          {failedItems.length > 5 && (
            <div className="mb-3">
              <label htmlFor="failed-items-search" className="sr-only">
                Search failed items
              </label>
              <input
                id="failed-items-search"
                type="text"
                placeholder="Search by item ID or error message..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-red-500 dark:focus:ring-red-400"
              />
            </div>
          )}

          {/* Failed Items Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b-2 border-gray-300 dark:border-gray-700">
                  <th className="text-left py-2 px-3 font-semibold text-gray-700 dark:text-gray-300">
                    Item ID
                  </th>
                  <th className="text-left py-2 px-3 font-semibold text-gray-700 dark:text-gray-300">
                    Error
                  </th>
                  <th className="text-left py-2 px-3 font-semibold text-gray-700 dark:text-gray-300">
                    Time
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="py-4 px-3 text-center text-gray-500 dark:text-gray-400">
                      No items match your search
                    </td>
                  </tr>
                ) : (
                  filteredItems.map((item, idx) => (
                    <tr
                      key={`${item.sourceItemId}-${idx}`}
                      className="border-b border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50"
                    >
                      <td className="py-2 px-3">
                        <code className="text-xs font-mono bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded text-gray-900 dark:text-gray-100">
                          {item.sourceItemId}
                        </code>
                      </td>
                      <td className="py-2 px-3">
                        <span className="text-red-600 dark:text-red-400 text-xs">
                          {item.error}
                        </span>
                      </td>
                      <td className="py-2 px-3">
                        <span className="text-gray-500 dark:text-gray-400 text-xs whitespace-nowrap">
                          {new Date(item.timestamp).toLocaleTimeString()}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Summary footer for filtered results */}
          {searchTerm && filteredItems.length > 0 && (
            <div className="mt-3 text-xs text-gray-600 dark:text-gray-400">
              Showing {filteredItems.length} of {failedItems.length} failed items
            </div>
          )}
        </div>
      )}
    </div>
  );
}
