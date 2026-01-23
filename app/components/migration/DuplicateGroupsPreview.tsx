/**
 * Duplicate Groups Preview Component
 * Shows detected duplicate groups and allows manual approval
 */

'use client';

import React, { useState, useMemo, useRef, useEffect } from 'react';
import { DuplicateGroup, CleanupMode } from '@/lib/migration/cleanup/types';

export interface DuplicateGroupsPreviewProps {
  groups: DuplicateGroup[];
  mode: CleanupMode;
  dryRun: boolean;
  onApproveAndExecute?: (approvedGroups: DuplicateGroup[]) => void;
  onProceed?: () => void; // Proceed after dry run (execute without re-scanning)
  isExecuting?: boolean;
}

export function DuplicateGroupsPreview({
  groups,
  mode,
  dryRun,
  onApproveAndExecute,
  onProceed,
  isExecuting = false,
}: DuplicateGroupsPreviewProps) {
  const [expandedGroups, setExpandedGroups] = useState<Set<number>>(new Set());
  const [selectedGroups, setSelectedGroups] = useState<Set<number>>(new Set());

  // Master checkbox ref for setting indeterminate property (DOM-only, not a React attribute)
  const masterCheckboxRef = useRef<HTMLInputElement>(null);

  // Derived state for master checkbox tri-state logic
  const allSelected = useMemo(
    () => groups.length > 0 && selectedGroups.size === groups.length,
    [groups.length, selectedGroups.size]
  );

  const isIndeterminate = useMemo(
    () => selectedGroups.size > 0 && selectedGroups.size < groups.length,
    [selectedGroups.size, groups.length]
  );

  // Sync indeterminate property to DOM (not available as React attribute)
  useEffect(() => {
    if (masterCheckboxRef.current) {
      masterCheckboxRef.current.indeterminate = isIndeterminate;
    }
  }, [isIndeterminate]);

  const isManualInteractive = mode === 'manual' && !dryRun;

  let masterCheckboxAriaLabel = 'Select all groups';
  if (allSelected) {
    masterCheckboxAriaLabel = 'Deselect all groups';
  } else if (isIndeterminate) {
    masterCheckboxAriaLabel = 'Select all groups (some selected)';
  }

  const toggleGroup = (index: number) => {
    const newExpanded = new Set(expandedGroups);
    if (newExpanded.has(index)) {
      newExpanded.delete(index);
    } else {
      newExpanded.add(index);
    }
    setExpandedGroups(newExpanded);
  };

  const toggleSelection = (index: number) => {
    const newSelected = new Set(selectedGroups);
    if (newSelected.has(index)) {
      newSelected.delete(index);
    } else {
      newSelected.add(index);
    }
    setSelectedGroups(newSelected);
  };

  const selectAll = () => {
    setSelectedGroups(new Set(groups.map((_, idx) => idx)));
  };

  const deselectAll = () => {
    setSelectedGroups(new Set());
  };

  // Master checkbox toggle: if all selected, deselect all; otherwise select all
  const handleMasterToggle = () => {
    if (allSelected) {
      deselectAll();
    } else {
      selectAll();
    }
  };

  const handleExecute = () => {
    if (!onApproveAndExecute) return;

    const approvedGroups = groups
      .filter((_, idx) => selectedGroups.has(idx))
      .map(group => ({
        ...group,
        approved: true,
      }));

    onApproveAndExecute(approvedGroups);
  };

  const totalDuplicates = groups.reduce((sum, g) => sum + g.items.length - 1, 0);
  const selectedDuplicates = groups
    .filter((_, idx) => selectedGroups.has(idx))
    .reduce((sum, g) => sum + (g.deleteItemIds?.length || g.items.length - 1), 0);

  const canExecute = isManualInteractive && selectedGroups.size > 0;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-200 dark:border-gray-700 pb-3">
        <div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            Duplicate Groups Found
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {groups.length} group{groups.length !== 1 ? 's' : ''} with {totalDuplicates} duplicate
            item{totalDuplicates !== 1 ? 's' : ''}
          </p>
        </div>

        {isManualInteractive && groups.length > 0 && (
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              ref={masterCheckboxRef}
              type="checkbox"
              checked={allSelected}
              onChange={handleMasterToggle}
              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700"
              aria-label={masterCheckboxAriaLabel}
            />
            <span className="text-sm text-gray-700 dark:text-gray-300">
              Select All
            </span>
          </label>
        )}
      </div>

      {/* Groups List */}
      <div className="space-y-3 max-h-96 overflow-y-auto">
        {groups.map((group, groupIdx) => {
          const isExpanded = expandedGroups.has(groupIdx);
          const isSelected = selectedGroups.has(groupIdx);
          const itemsToDelete = group.deleteItemIds?.length || group.items.length - 1;

          return (
            <div
              key={groupIdx}
              className={`
                border rounded-md overflow-hidden
                ${
                  isSelected
                    ? 'border-blue-500 dark:border-blue-400'
                    : 'border-gray-200 dark:border-gray-700'
                }
              `}
            >
              {/* Group Header */}
              <div
                className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 cursor-pointer"
                onClick={() => toggleGroup(groupIdx)}
              >
                <div className="flex items-center gap-3 flex-1">
                  {isManualInteractive && (
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelection(groupIdx)}
                      onClick={(e) => e.stopPropagation()}
                      className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700"
                      aria-label={`Select group with match value ${group.matchValue}`}
                    />
                  )}
                  <div className="flex-1">
                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                      Match Value: <span className="font-mono">{group.matchValue}</span>
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      {group.items.length} items ({itemsToDelete} duplicate
                      {itemsToDelete !== 1 ? 's' : ''} to delete)
                    </div>
                  </div>
                </div>
                <svg
                  className={`h-5 w-5 text-gray-400 transition-transform ${
                    isExpanded ? 'rotate-180' : ''
                  }`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 9l-7 7-7-7"
                  />
                </svg>
              </div>

              {/* Group Details (Expanded) */}
              {isExpanded && (
                <div className="p-3 border-t border-gray-200 dark:border-gray-700">
                  <div className="space-y-2">
                    {group.items.map((item, itemIdx) => {
                      const isKeep = group.keepItemId
                        ? item.itemId === group.keepItemId
                        : itemIdx === 0;

                      return (
                        <div
                          key={item.itemId}
                          className={`
                            flex items-center justify-between p-2 rounded
                            ${
                              isKeep
                                ? 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800'
                                : 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800'
                            }
                          `}
                        >
                          <div className="flex-1">
                            <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                              {item.title}
                            </div>
                            <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                              Created: {new Date(item.createdOn).toLocaleDateString()}{' '}
                              {new Date(item.createdOn).toLocaleTimeString()}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {isKeep ? (
                              <span className="px-2 py-1 rounded text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                                KEEP
                              </span>
                            ) : (
                              <span className="px-2 py-1 rounded text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200">
                                DELETE
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Action Buttons */}
      {isManualInteractive && (
        <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm text-gray-700 dark:text-gray-300">
              {selectedGroups.size > 0 ? (
                <>
                  <span className="font-medium">{selectedGroups.size}</span> group
                  {selectedGroups.size !== 1 ? 's' : ''} selected (
                  <span className="font-medium">{selectedDuplicates}</span> item
                  {selectedDuplicates !== 1 ? 's' : ''} will be deleted)
                </>
              ) : (
                'Select groups to approve for deletion'
              )}
            </div>
          </div>
          <button
            onClick={handleExecute}
            disabled={!canExecute || isExecuting}
            className={`
              w-full px-4 py-2 rounded-md font-medium text-white
              ${
                canExecute && !isExecuting
                  ? 'bg-red-600 hover:bg-red-700'
                  : 'bg-gray-400 cursor-not-allowed'
              }
            `}
          >
            {isExecuting
              ? 'Deleting...'
              : `Delete ${selectedDuplicates} Duplicate Item${selectedDuplicates !== 1 ? 's' : ''}`}
          </button>
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400 text-center">
            This action cannot be undone. The oldest item in each group will be kept.
          </p>
        </div>
      )}

      {/* Dry Run Notice */}
      {dryRun && (
        <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
          <div className="rounded-md bg-blue-50 dark:bg-blue-900/20 p-3 border border-blue-200 dark:border-blue-800">
            <div className="flex">
              <svg
                className="h-5 w-5 text-blue-400 dark:text-blue-500"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                  clipRule="evenodd"
                />
              </svg>
              <div className="ml-3">
                <p className="text-sm text-blue-700 dark:text-blue-300">
                  Dry run complete - no items have been deleted yet.
                </p>
              </div>
            </div>
          </div>

          {/* Proceed Button */}
          {onProceed && totalDuplicates > 0 && (
            <div className="mt-4">
              <button
                onClick={onProceed}
                disabled={isExecuting}
                className={`
                  w-full px-4 py-2 rounded-md font-medium text-white
                  ${
                    !isExecuting
                      ? 'bg-red-600 hover:bg-red-700'
                      : 'bg-gray-400 cursor-not-allowed'
                  }
                `}
              >
                {isExecuting
                  ? 'Deleting...'
                  : `Proceed with Deletion (${totalDuplicates} item${totalDuplicates !== 1 ? 's' : ''})`}
              </button>
              <p className="mt-2 text-xs text-gray-500 dark:text-gray-400 text-center">
                This will delete the duplicates shown above. This action cannot be undone.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
