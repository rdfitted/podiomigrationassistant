'use client';

import React from 'react';

export interface ErrorCategoryStatsProps {
  categories: Record<string, {
    count: number;
    percentage: number;
    shouldRetry: boolean;
  }>;
}

/**
 * Error Category Stats Component
 * Displays error statistics broken down by category
 */
export function ErrorCategoryStats({ categories }: ErrorCategoryStatsProps) {
  const entries = Object.entries(categories);

  if (entries.length === 0) {
    return null;
  }

  // Category-specific colors and icons
  const categoryConfig: Record<string, { color: string; icon: string; label: string }> = {
    network: {
      color: 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300 border-blue-200 dark:border-blue-700',
      icon: '🌐',
      label: 'Network Error',
    },
    rate_limit: {
      color: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300 border-yellow-200 dark:border-yellow-700',
      icon: '⏱️',
      label: 'Rate Limit',
    },
    validation: {
      color: 'bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-300 border-purple-200 dark:border-purple-700',
      icon: '⚠️',
      label: 'Validation Error',
    },
    permission: {
      color: 'bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-300 border-orange-200 dark:border-orange-700',
      icon: '🔒',
      label: 'Permission Denied',
    },
    duplicate: {
      color: 'bg-pink-100 dark:bg-pink-900/30 text-pink-800 dark:text-pink-300 border-pink-200 dark:border-pink-700',
      icon: '📋',
      label: 'Duplicate Item',
    },
    unknown: {
      color: 'bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-300 border-gray-200 dark:border-gray-700',
      icon: '❓',
      label: 'Unknown Error',
    },
  };

  return (
    <div>
      <h5 className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2 uppercase tracking-wide">
        Error Categories
      </h5>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {entries.map(([category, stats]) => {
          const config = categoryConfig[category] || categoryConfig.unknown;

          return (
            <div
              key={category}
              className={`p-3 border rounded-md ${config.color}`}
            >
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span className="text-lg" aria-hidden="true">
                    {config.icon}
                  </span>
                  <span className="text-xs font-medium">
                    {config.label}
                  </span>
                </div>
              </div>

              <div className="flex items-baseline gap-2 mb-1">
                <span className="text-2xl font-bold">
                  {stats.count}
                </span>
                <span className="text-sm font-normal opacity-75">
                  ({stats.percentage.toFixed(1)}%)
                </span>
              </div>

              {stats.shouldRetry && (
                <div className="mt-2">
                  <span className="inline-block px-2 py-0.5 text-xs bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-300 border border-green-200 dark:border-green-700 rounded-full font-medium">
                    ✓ Retryable
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
