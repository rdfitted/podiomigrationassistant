'use client';

import React from 'react';

export type MigrationTabType = 'flows' | 'items';

export interface Tab {
  id: MigrationTabType;
  label: string;
  badge?: number | string;
  icon?: React.ReactNode;
}

export interface TabContainerProps {
  activeTab: MigrationTabType;
  onTabChange: (tab: MigrationTabType) => void;
  tabs: Tab[];
  children: React.ReactNode;
}

/**
 * Tab container component for migration tools
 * Provides tabbed interface to separate flow and item migration
 */
export function TabContainer({ activeTab, onTabChange, tabs, children }: TabContainerProps) {
  return (
    <div className="mt-8">
      {/* Tab Navigation */}
      <div className="border-b border-gray-200 dark:border-gray-700">
        <nav className="flex space-x-4" aria-label="Migration Tabs">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => onTabChange(tab.id)}
                className={`
                  relative py-3 px-4 text-sm font-medium transition-colors
                  ${
                    isActive
                      ? 'text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400'
                      : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                  }
                `}
                aria-current={isActive ? 'page' : undefined}
              >
                <span className="flex items-center gap-2">
                  {tab.icon}
                  {tab.label}
                  {tab.badge !== undefined && (
                    <span
                      className={`
                        inline-flex items-center justify-center px-2 py-0.5 text-xs font-medium rounded-full
                        ${
                          isActive
                            ? 'bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200'
                            : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'
                        }
                      `}
                    >
                      {tab.badge}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* Tab Content */}
      <div className="mt-6">{children}</div>
    </div>
  );
}
