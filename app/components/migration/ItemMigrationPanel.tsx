'use client';

import React, { useState, useEffect } from 'react';
import { useItemMigration } from '@/app/hooks/useItemMigration';
import { ItemMigrationProgress } from './ItemMigrationProgress';
import { DryRunPreview } from './DryRunPreview';
import { FieldMappingEditor } from './FieldMappingEditor';
import { AppFieldInfo } from './FieldMappingRow';
import { ResumptionConfig } from '@/lib/migration/items/types';

export interface ItemMigrationPanelProps {
  sourceAppId?: number;
  targetAppId?: number;
}

/**
 * Item Migration Panel Component
 * Allows users to start and monitor large-scale item migrations
 */
interface MigrationListItem {
  id: string;
  status: string;
  startedAt: string;
  completedAt?: string;
  progress?: {
    total: number;
    processed: number;
    successful: number;
    failed: number;
    percent: number;
  };
  metadata?: {
    sourceAppId?: number;
    targetAppId?: number;
  };
}

export function ItemMigrationPanel({ sourceAppId, targetAppId }: ItemMigrationPanelProps) {
  const [mode, setMode] = useState<'create' | 'update' | 'upsert'>('create');
  const [sourceMatchField, setSourceMatchField] = useState<string>('');
  const [targetMatchField, setTargetMatchField] = useState<string>('');
  const [duplicateBehavior, setDuplicateBehavior] = useState<'skip' | 'error' | 'update'>('skip');
  const [batchSize, setBatchSize] = useState<number>(500);
  const [concurrency, setConcurrency] = useState<number>(5);
  const [maxItems, setMaxItems] = useState<number | undefined>(undefined);
  const [dryRun, setDryRun] = useState<boolean>(false); // Dry-run mode toggle
  const [transferFiles, setTransferFiles] = useState<boolean>(false); // File transfer toggle
  const [showFieldMapping, setShowFieldMapping] = useState(false);
  const [showSourceFilters, setShowSourceFilters] = useState(false);

  // Source filters state
  const [createdFrom, setCreatedFrom] = useState<string>('');
  const [createdTo, setCreatedTo] = useState<string>('');
  const [lastEditFrom, setLastEditFrom] = useState<string>('');
  const [lastEditTo, setLastEditTo] = useState<string>('');
  const [tagsInput, setTagsInput] = useState<string>(''); // Comma-separated tags
  const [showPastMigrations, setShowPastMigrations] = useState(false);
  const [pastMigrations, setPastMigrations] = useState<MigrationListItem[]>([]);
  const [isLoadingMigrations, setIsLoadingMigrations] = useState(false);
  const [migrationsPage, setMigrationsPage] = useState(0);
  const [migrationsTotalCount, setMigrationsTotalCount] = useState(0);
  const [migrationsHasMore, setMigrationsHasMore] = useState(false);
  const MIGRATIONS_PER_PAGE = 10;

  // Field structures for dropdowns
  const [sourceFields, setSourceFields] = useState<AppFieldInfo[]>([]);
  const [targetFields, setTargetFields] = useState<AppFieldInfo[]>([]);
  const [isLoadingFields, setIsLoadingFields] = useState(false);

  // Validation state
  const [isValidating, setIsValidating] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [validationProgress, setValidationProgress] = useState<{
    testedItems: number;
    successfulCreates: number;
    failedCreates: number;
  } | null>(null);

  const {
    jobId,
    jobStatus,
    isCreating,
    isPolling,
    isRetrying,
    error,
    fieldMapping,
    fieldMappingOverride,
    updateFieldMapping,
    startMigration,
    loadMigration,
    retryFailedItems,
    reset,
  } = useItemMigration({ sourceAppId, targetAppId });

  const currentMapping = fieldMappingOverride || fieldMapping;
  const isUsingCustomMapping = !!fieldMappingOverride;

  // Calculate actual failed count (source of truth: failedItems.length)
  const actualFailedCount = jobStatus
    ? Math.max(jobStatus.progress?.failed || 0, jobStatus.failedItems?.length || 0)
    : 0;

  // Reset transferFiles when mode changes to 'create'
  useEffect(() => {
    if (mode === 'create') {
      setTransferFiles(false);
    }
  }, [mode]);

  // Fetch field structures when app IDs change
  useEffect(() => {
    async function loadFields() {
      if (!sourceAppId || !targetAppId) {
        setSourceFields([]);
        setTargetFields([]);
        return;
      }

      setIsLoadingFields(true);
      try {
        const [sourceResponse, targetResponse] = await Promise.all([
          fetch(`/api/podio/apps/${sourceAppId}/structure`),
          fetch(`/api/podio/apps/${targetAppId}/structure`),
        ]);

        if (sourceResponse.ok && targetResponse.ok) {
          const [sourceApp, targetApp] = await Promise.all([
            sourceResponse.json(),
            targetResponse.json(),
          ]);

          setSourceFields(sourceApp.fields || []);
          setTargetFields(targetApp.fields || []);
        }
      } catch (err) {
        console.error('Failed to load field structures:', err);
      } finally {
        setIsLoadingFields(false);
      }
    }

    loadFields();
  }, [sourceAppId, targetAppId]);

  // Fetch past migrations when component mounts, when panel is opened, or when page changes
  useEffect(() => {
    async function loadPastMigrations() {
      if (!showPastMigrations) return;

      setIsLoadingMigrations(true);
      try {
        const skip = migrationsPage * MIGRATIONS_PER_PAGE;
        const response = await fetch(`/api/migration/items?limit=${MIGRATIONS_PER_PAGE}&skip=${skip}`);
        if (response.ok) {
          const data = await response.json();
          setPastMigrations(data.migrations || []);
          setMigrationsTotalCount(data.total || 0);
          setMigrationsHasMore(data.hasMore || false);
        }
      } catch (err) {
        console.error('Failed to load past migrations:', err);
      } finally {
        setIsLoadingMigrations(false);
      }
    }

    loadPastMigrations();
  }, [showPastMigrations, migrationsPage, MIGRATIONS_PER_PAGE]);

  // Reset page when panel is toggled open
  useEffect(() => {
    if (showPastMigrations) {
      setMigrationsPage(0);
    }
  }, [showPastMigrations]);

  const handleLoadMigration = async (migrationId: string) => {
    await loadMigration(migrationId);
    setShowPastMigrations(false);
  };

  const handleStartMigration = async () => {
    // Clear previous validation state
    setValidationError(null);
    setValidationProgress(null);

    // Only validate for CREATE mode when not in dry-run
    // (validation creates/deletes test items, which violates dry-run contract)
    if (mode === 'create' && !dryRun) {
      setIsValidating(true);

      try {
        // Step 1: Validate field mappings
        const validationResponse = await fetch('/api/migration/items/validate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sourceAppId,
            targetAppId,
            fieldMapping: currentMapping,
          }),
        });

        const validationResult = await validationResponse.json();

        setValidationProgress({
          testedItems: validationResult.testedItems,
          successfulCreates: validationResult.successfulCreates,
          failedCreates: validationResult.failedCreates,
        });

        if (!validationResult.valid) {
          setValidationError(validationResult.error);
          setIsValidating(false);
          return; // STOP - don't proceed with migration
        }

        // Validation passed!
        setIsValidating(false);

      } catch (error) {
        setValidationError(error instanceof Error ? error.message : String(error));
        setIsValidating(false);
        return;
      }
    }

    // Build source filters if any are set
    const parsedTags = tagsInput
      .split(',')
      .map(tag => tag.trim())
      .filter(tag => tag.length > 0);

    const filters = (createdFrom || createdTo || lastEditFrom || lastEditTo || parsedTags.length > 0)
      ? {
          ...(createdFrom && { createdFrom }),
          ...(createdTo && { createdTo }),
          ...(lastEditFrom && { lastEditFrom }),
          ...(lastEditTo && { lastEditTo }),
          ...(parsedTags.length > 0 && { tags: parsedTags }),
        }
      : undefined;

    // Step 2: Start actual migration (or dry-run)
    await startMigration({
      mode,
      sourceMatchField: sourceMatchField || undefined,
      targetMatchField: targetMatchField || undefined,
      duplicateBehavior,
      batchSize,
      concurrency,
      stopOnError: false,
      maxItems,
      dryRun, // Dry-run is now supported for all modes (CREATE, UPDATE, UPSERT)
      transferFiles: (mode === 'update' || mode === 'upsert') ? transferFiles : undefined, // Only for UPDATE/UPSERT modes
      // If transferring files without custom field mapping, explicitly pass empty mapping to prevent auto-mapping
      fieldMapping: (!isUsingCustomMapping && transferFiles && (mode === 'update' || mode === 'upsert')) ? {} : undefined,
      filters, // Source item filters (date ranges and tags)
    });
  };

  // Validation logic for match fields
  const requiresBothMatchFields = mode === 'update' || mode === 'upsert';
  const hasBothMatchFields = !!(sourceMatchField && targetMatchField);
  const hasEitherMatchField = !!(sourceMatchField || targetMatchField);

  // Validation message
  let validationMessage = '';
  if (requiresBothMatchFields && !hasBothMatchFields) {
    validationMessage = `${mode.toUpperCase()} mode requires both source and target match fields`;
  } else if (hasEitherMatchField && !hasBothMatchFields) {
    validationMessage = 'Both source and target match fields must be set (or both empty)';
  }

  // Field type validation for match fields
  const VALID_MATCH_FIELD_TYPES = ['text', 'number', 'calculation'];

  const validateMatchFieldTypes = (
    sourceFieldType: string | undefined,
    targetFieldType: string | undefined
  ): { valid: boolean; warning?: string } => {
    if (!sourceFieldType || !targetFieldType) {
      return { valid: true };
    }

    // Check if both types are in valid list
    const sourceValid = VALID_MATCH_FIELD_TYPES.includes(sourceFieldType);
    const targetValid = VALID_MATCH_FIELD_TYPES.includes(targetFieldType);

    if (!sourceValid && !targetValid) {
      return {
        valid: false,
        warning: `Neither field type is supported for matching. Source is '${sourceFieldType}', target is '${targetFieldType}'. Supported types: text, number, calculation.`,
      };
    }

    if (!sourceValid) {
      return {
        valid: false,
        warning: `Source field type '${sourceFieldType}' is not recommended for matching. Supported types: text, number, calculation.`,
      };
    }

    if (!targetValid) {
      return {
        valid: false,
        warning: `Target field type '${targetFieldType}' is not recommended for matching. Supported types: text, number, calculation.`,
      };
    }

    // Both valid - return success
    return { valid: true };
  };

  const canStart = sourceAppId && targetAppId && !jobId && !isCreating && !validationMessage;
  const isActive = !!(jobId && (isPolling || jobStatus?.status === 'in_progress'));

  return (
    <div className="mt-8 pt-8 border-t border-gray-200 dark:border-gray-700">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
        Item Migration
      </h3>

      {/* Past Migrations Section - Only show when no active job */}
      {!jobId && (
        <div className="mb-4 border border-gray-200 dark:border-gray-700 rounded-md">
          <button
            onClick={() => setShowPastMigrations(!showPastMigrations)}
            className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-gray-50 dark:hover:bg-gray-800 rounded-t-md"
            type="button"
          >
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Past Migrations
              </span>
              {migrationsTotalCount > 0 && (
                <span className="text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 px-2 py-0.5 rounded">
                  {migrationsTotalCount}
                </span>
              )}
            </div>
            <svg
              className={`w-5 h-5 transition-transform ${showPastMigrations ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {showPastMigrations && (
            <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700">
              {isLoadingMigrations ? (
                <div className="text-center py-4 text-sm text-gray-500 dark:text-gray-400">
                  Loading migrations...
                </div>
              ) : pastMigrations.length === 0 ? (
                <div className="text-center py-4 text-sm text-gray-500 dark:text-gray-400">
                  No past migrations found
                </div>
              ) : (
                <>
                  <div className="space-y-2">
                    {pastMigrations.map((migration) => (
                      <div
                        key={migration.id}
                        className="p-3 border border-gray-200 dark:border-gray-600 rounded-md"
                      >
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <StatusBadge status={migration.status} />
                            <span className="text-xs text-gray-500 dark:text-gray-400">
                              {new Date(migration.startedAt).toLocaleString()}
                            </span>
                          </div>
                          {migration.progress && (
                            <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                              {migration.progress.processed} / {migration.progress.total} items
                            </span>
                          )}
                        </div>
                        {migration.progress && (
                          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5 mb-2">
                            <div
                              className="bg-blue-600 h-1.5 rounded-full transition-all"
                              style={{ width: `${migration.progress.percent}%` }}
                            />
                          </div>
                        )}
                        {/* Action buttons */}
                        <PastMigrationActions
                          migration={migration}
                          onView={() => handleLoadMigration(migration.id)}
                          onActionComplete={() => {
                            // Reload migrations list after action
                            setMigrationsPage(0);
                          }}
                        />
                      </div>
                    ))}
                  </div>

                  {/* Pagination controls */}
                  {migrationsTotalCount > MIGRATIONS_PER_PAGE && (
                    <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        Showing {migrationsPage * MIGRATIONS_PER_PAGE + 1}-{Math.min((migrationsPage + 1) * MIGRATIONS_PER_PAGE, migrationsTotalCount)} of {migrationsTotalCount}
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setMigrationsPage(p => Math.max(0, p - 1))}
                          disabled={migrationsPage === 0}
                          className="px-3 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-gray-800"
                        >
                          Previous
                        </button>
                        <button
                          onClick={() => setMigrationsPage(p => p + 1)}
                          disabled={!migrationsHasMore}
                          className="px-3 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-gray-800"
                        >
                          Next
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Configuration Form */}
      {!jobId && (
        <div className="space-y-4">
          {/* Field Mapping Section */}
          <div className="border border-gray-200 dark:border-gray-700 rounded-md">
            <button
              onClick={() => setShowFieldMapping(!showFieldMapping)}
              className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-gray-50 dark:hover:bg-gray-800 rounded-t-md"
              type="button"
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Field Mapping
                </span>
                {isUsingCustomMapping && (
                  <span className="text-xs bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 px-2 py-0.5 rounded">
                    Custom
                  </span>
                )}
                {!isUsingCustomMapping && currentMapping && (
                  <>
                    {/* Show "Files-only" chip when transferring files without field updates */}
                    {transferFiles && (mode === 'update' || mode === 'upsert') ? (
                      <span className="text-xs bg-purple-100 dark:bg-purple-900 text-purple-800 dark:text-purple-200 px-2 py-0.5 rounded">
                        Files-only
                      </span>
                    ) : (
                      <span className="text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 px-2 py-0.5 rounded">
                        Auto
                      </span>
                    )}
                  </>
                )}
              </div>
              <svg
                className={`w-5 h-5 transition-transform ${showFieldMapping ? 'rotate-180' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {showFieldMapping && sourceAppId && targetAppId && (
              <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700">
                <FieldMappingEditor
                  sourceAppId={sourceAppId}
                  targetAppId={targetAppId}
                  initialMapping={currentMapping || undefined}
                  onMappingChange={updateFieldMapping}
                />
              </div>
            )}
          </div>

          {/* Source Filters Section */}
          <div className="border border-gray-200 dark:border-gray-700 rounded-md">
            <button
              onClick={() => setShowSourceFilters(!showSourceFilters)}
              className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-gray-50 dark:hover:bg-gray-800 rounded-t-md"
              type="button"
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Source Filters
                </span>
                {(createdFrom || createdTo || lastEditFrom || lastEditTo || tagsInput.trim().split(',').some(tag => tag.trim().length > 0)) && (
                  <span className="text-xs bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 px-2 py-0.5 rounded">
                    Active
                  </span>
                )}
              </div>
              <svg
                className={`w-5 h-5 transition-transform ${showSourceFilters ? 'rotate-180' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {showSourceFilters && (
              <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 space-y-4">
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Filter source items by creation date, last edit date, or tags. Only matching items will be migrated.
                </p>

                {/* Created Date Range */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Created Date Range
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">From</label>
                      <input
                        type="date"
                        value={createdFrom}
                        onChange={(e) => setCreatedFrom(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm"
                        disabled={isCreating}
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">To</label>
                      <input
                        type="date"
                        value={createdTo}
                        onChange={(e) => setCreatedTo(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm"
                        disabled={isCreating}
                      />
                    </div>
                  </div>
                </div>

                {/* Last Edited Date Range */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Last Edited Date Range
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">From</label>
                      <input
                        type="date"
                        value={lastEditFrom}
                        onChange={(e) => setLastEditFrom(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm"
                        disabled={isCreating}
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">To</label>
                      <input
                        type="date"
                        value={lastEditTo}
                        onChange={(e) => setLastEditTo(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm"
                        disabled={isCreating}
                      />
                    </div>
                  </div>
                </div>

                {/* Tags Filter */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Tags Filter
                  </label>
                  <input
                    type="text"
                    value={tagsInput}
                    onChange={(e) => setTagsInput(e.target.value)}
                    placeholder="Enter tags separated by commas (e.g., urgent, active)"
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm"
                    disabled={isCreating}
                  />
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    Only items with ALL specified tags will be included (case-sensitive)
                  </p>
                </div>

                {/* Clear Filters Button */}
                {(createdFrom || createdTo || lastEditFrom || lastEditTo || tagsInput.trim().split(',').some(tag => tag.trim().length > 0)) && (
                  <button
                    type="button"
                    onClick={() => {
                      setCreatedFrom('');
                      setCreatedTo('');
                      setLastEditFrom('');
                      setLastEditTo('');
                      setTagsInput('');
                    }}
                    className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
                    disabled={isCreating}
                  >
                    Clear all filters
                  </button>
                )}
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Migration Mode
            </label>
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as 'create' | 'update' | 'upsert')}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
              disabled={isCreating}
            >
              <option value="create">Create (new items only)</option>
              <option value="update">Update (existing items only)</option>
              <option value="upsert">Upsert (create or update)</option>
            </select>
          </div>

          {/* Match Field Selection - Two Separate Dropdowns */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Source Match Field {(mode === 'update' || mode === 'upsert') && <span className="text-red-500">*</span>}
              </label>
              <select
                value={sourceMatchField}
                onChange={(e) => setSourceMatchField(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                disabled={isCreating || isLoadingFields || sourceFields.length === 0}
              >
                <option value="">
                  {mode === 'create' ? 'None' : 'Select source field...'}
                </option>
                {sourceFields.map((field) => (
                  <option key={field.field_id} value={field.external_id}>
                    {field.label} ({field.type})
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Field to extract value from
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Target Match Field {(mode === 'update' || mode === 'upsert') && <span className="text-red-500">*</span>}
              </label>
              <select
                value={targetMatchField}
                onChange={(e) => setTargetMatchField(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                disabled={isCreating || isLoadingFields || targetFields.length === 0}
              >
                <option value="">
                  {mode === 'create' ? 'None' : 'Select target field...'}
                </option>
                {targetFields.map((field) => (
                  <option key={field.field_id} value={field.external_id}>
                    {field.label} ({field.type})
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Field to search by
              </p>
            </div>
          </div>

          {/* Help text for match fields */}
          <div className="text-xs text-gray-500 dark:text-gray-400 -mt-2">
            {mode === 'create' && 'Optional: Set both fields to enable duplicate detection'}
            {mode === 'update' && 'Required: Both fields must be set to match items for updating'}
            {mode === 'upsert' && 'Required: Both fields must be set (update if exists, create if not)'}
          </div>

          {/* Field Type Warning */}
          {sourceMatchField && targetMatchField && (() => {
            const sourceField = sourceFields.find(f => f.external_id === sourceMatchField);
            const targetField = targetFields.find(f => f.external_id === targetMatchField);
            const validation = validateMatchFieldTypes(sourceField?.type, targetField?.type);

            if (validation.warning) {
              return (
                <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-md p-3">
                  <div className="flex">
                    <div className="flex-shrink-0">
                      <svg className="h-5 w-5 text-yellow-400" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                      </svg>
                    </div>
                    <div className="ml-3">
                      <h3 className="text-sm font-medium text-yellow-800 dark:text-yellow-200">
                        Field Type Warning
                      </h3>
                      <p className="mt-1 text-sm text-yellow-700 dark:text-yellow-300">
                        {validation.warning}
                      </p>
                      <p className="mt-2 text-xs text-yellow-600 dark:text-yellow-400">
                        You can proceed, but matching may not work as expected. The pre-flight validation will test your configuration.
                      </p>
                    </div>
                  </div>
                </div>
              );
            }
            return null;
          })()}

          {/* Duplicate Behavior - only show for CREATE mode with both match fields */}
          {mode === 'create' && sourceMatchField && targetMatchField && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                When Duplicate Found
              </label>
              <div className="space-y-2">
                <label className="flex items-center">
                  <input
                    type="radio"
                    value="skip"
                    checked={duplicateBehavior === 'skip'}
                    onChange={(e) => setDuplicateBehavior(e.target.value as 'skip' | 'error' | 'update')}
                    className="mr-2"
                    disabled={isCreating}
                  />
                  <span className="text-sm text-gray-700 dark:text-gray-300">
                    Skip (continue without creating)
                  </span>
                </label>
                <label className="flex items-center">
                  <input
                    type="radio"
                    value="error"
                    checked={duplicateBehavior === 'error'}
                    onChange={(e) => setDuplicateBehavior(e.target.value as 'skip' | 'error' | 'update')}
                    className="mr-2"
                    disabled={isCreating}
                  />
                  <span className="text-sm text-gray-700 dark:text-gray-300">
                    Error (stop migration)
                  </span>
                </label>
                <label className="flex items-center">
                  <input
                    type="radio"
                    value="update"
                    checked={duplicateBehavior === 'update'}
                    onChange={(e) => setDuplicateBehavior(e.target.value as 'skip' | 'error' | 'update')}
                    className="mr-2"
                    disabled={isCreating}
                  />
                  <span className="text-sm text-gray-700 dark:text-gray-300">
                    Update (update existing item instead)
                  </span>
                </label>
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Max Items (optional - for testing)
            </label>
            <input
              type="number"
              value={maxItems || ''}
              onChange={(e) => setMaxItems(e.target.value ? parseInt(e.target.value) : undefined)}
              min="1"
              placeholder="Leave empty for all items"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
              disabled={isCreating}
            />
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Limit the number of items to migrate (useful for testing)
            </p>
          </div>

          {/* Dry-Run Mode - Show for all modes */}
          <div className="bg-blue-50 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-800 rounded-md p-4">
            <label className="flex items-start cursor-pointer">
              <input
                type="checkbox"
                checked={dryRun}
                onChange={(e) => setDryRun(e.target.checked)}
                className="mt-0.5 mr-3 h-4 w-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                disabled={isCreating}
              />
              <div>
                <span className="text-sm font-medium text-blue-900 dark:text-blue-100">
                  🔍 Dry-Run Mode (Preview Changes)
                </span>
                <p className="mt-1 text-xs text-blue-700 dark:text-blue-300">
                  {mode === 'create'
                    ? 'Preview exactly what items would be created without executing any changes. See field values, identify duplicates, and skip items with missing fields.'
                    : mode === 'update'
                    ? 'Preview exactly what would be updated without executing any changes. See field-by-field changes, identify missing matches, and skip items with no changes.'
                    : 'Preview exactly what would be updated or created without executing any changes. See field-by-field changes, identify missing matches, and skip items with no changes.'}
                </p>
              </div>
            </label>
          </div>

          {/* File Transfer - Always visible, disabled for CREATE mode */}
          <div className={`rounded-md p-4 ${
            mode === 'create'
              ? 'bg-gray-50 dark:bg-gray-900/10 border border-gray-200 dark:border-gray-700'
              : 'bg-purple-50 dark:bg-purple-900/10 border border-purple-200 dark:border-purple-800'
          }`}>
            <label className="flex items-start cursor-pointer">
              <input
                type="checkbox"
                checked={transferFiles}
                onChange={(e) => setTransferFiles(e.target.checked)}
                className="mt-0.5 mr-3 h-4 w-4 text-purple-600 rounded border-gray-300 focus:ring-purple-500"
                disabled={isCreating || mode === 'create'}
              />
              <div>
                <span className={`text-sm font-medium ${
                  mode === 'create'
                    ? 'text-gray-600 dark:text-gray-400'
                    : 'text-purple-900 dark:text-purple-100'
                }`}>
                  📎 Files
                </span>
                <p className={`mt-1 text-xs ${
                  mode === 'create'
                    ? 'text-gray-500 dark:text-gray-500'
                    : 'text-purple-700 dark:text-purple-300'
                }`}>
                  {mode === 'create'
                    ? 'File transfer is only available for UPDATE and UPSERT modes where items already exist in the destination.'
                    : 'Transfer all attached files from source items to destination items. Files will be downloaded from source and re-uploaded to the target app.'}
                </p>
                {/* Show note when in files-only mode (no custom mapping + files enabled) */}
                {transferFiles && !isUsingCustomMapping && (mode === 'update' || mode === 'upsert') && (
                  <div className="mt-2 p-2 bg-purple-100 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded text-xs text-purple-800 dark:text-purple-200">
                    ℹ️ <strong>Files-only mode:</strong> Only files will be transferred. Item fields will not be updated. To update fields, configure custom field mapping above.
                  </div>
                )}
              </div>
            </label>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Batch Size
              </label>
              <input
                type="number"
                value={batchSize}
                onChange={(e) => setBatchSize(parseInt(e.target.value) || 500)}
                min="100"
                max="1000"
                step="100"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                disabled={isCreating}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Concurrency
              </label>
              <input
                type="number"
                value={concurrency}
                onChange={(e) => setConcurrency(parseInt(e.target.value) || 5)}
                min="1"
                max="10"
                step="1"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                disabled={isCreating}
              />
            </div>
          </div>

          {/* Validation Progress */}
          {isValidating && (
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-md p-4">
              <div className="flex items-center">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600 mr-3"></div>
                <span className="text-sm font-medium text-blue-900 dark:text-blue-100">
                  Validating field mappings...
                </span>
              </div>
              {validationProgress && (
                <div className="mt-2 text-xs text-blue-700 dark:text-blue-300">
                  Testing with {validationProgress.testedItems} sample items
                  {validationProgress.successfulCreates > 0 && (
                    <span className="ml-2">✓ {validationProgress.successfulCreates} succeeded</span>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Validation Error */}
          {validationError && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md p-4">
              <div className="flex">
                <div className="flex-shrink-0">
                  <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                  </svg>
                </div>
                <div className="ml-3">
                  <h3 className="text-sm font-medium text-red-800 dark:text-red-200">
                    Field Mapping Validation Failed
                  </h3>
                  <div className="mt-2 text-sm text-red-700 dark:text-red-300">
                    <pre className="whitespace-pre-wrap font-mono text-xs">
                      {validationError}
                    </pre>
                  </div>
                  <p className="mt-2 text-xs text-red-600 dark:text-red-400">
                    Please fix the field mappings above and try again.
                  </p>
                </div>
              </div>
            </div>
          )}

          <button
            onClick={handleStartMigration}
            disabled={!canStart || isValidating}
            className={`w-full py-2 px-4 rounded-md font-medium transition-colors ${
              canStart && !isValidating
                ? dryRun
                  ? 'bg-green-600 hover:bg-green-700 text-white'
                  : 'bg-blue-600 hover:bg-blue-700 text-white'
                : 'bg-gray-300 dark:bg-gray-700 text-gray-500 dark:text-gray-400 cursor-not-allowed'
            }`}
          >
            {isValidating
              ? 'Validating...'
              : isCreating
                ? dryRun ? 'Generating Preview...' : 'Starting Migration...'
                : dryRun ? '🔍 Preview Changes (Dry-Run)' : 'Start Item Migration'
            }
          </button>

          {validationMessage && (
            <p className="text-sm text-amber-600 dark:text-amber-400 text-center">
              {validationMessage}
            </p>
          )}

          {!sourceAppId || !targetAppId ? (
            <p className="text-sm text-gray-500 dark:text-gray-400 text-center">
              Select both source and target apps to begin
            </p>
          ) : null}
        </div>
      )}

      {/* Error Display */}
      {error && (
        <div className="mt-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md">
          <div className="flex items-start">
            <svg className="w-5 h-5 text-red-600 dark:text-red-400 mt-0.5 mr-3" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
            </svg>
            <div>
              <h4 className="text-sm font-medium text-red-800 dark:text-red-300">Error</h4>
              <p className="text-sm text-red-700 dark:text-red-400 mt-1">{error}</p>
            </div>
          </div>
        </div>
      )}

      {/* Progress Display or Dry-Run Preview */}
      {jobId && jobStatus && (
        <div className="mt-4">
          {/* Show Dry-Run Preview if available */}
          {(jobStatus as any).dryRunPreview ? (
            <DryRunPreview
              preview={(jobStatus as any).dryRunPreview}
              onExecute={() => {
                // Reset and run again without dry-run
                setDryRun(false);
                reset();
                setTimeout(() => {
                  handleStartMigration();
                }, 100);
              }}
              onReset={reset}
            />
          ) : (
            <ItemMigrationProgress jobStatus={jobStatus} isActive={isActive} />
          )}

          {/* Pause/Resume/Retry/Reset Controls */}
          {!(jobStatus as any).dryRunPreview && (
          <div className="mt-4 flex gap-2">
            {jobStatus.status === 'in_progress' && (
              <PauseButton jobId={jobId} />
            )}

            {jobStatus.status === 'paused' && (
              <ResumeButton jobId={jobId} resumption={jobStatus.resumption} />
            )}

            {/* Retry Failed Items Button - Show when there are failed items (not available for UPDATE mode) */}
            {jobId && jobStatus && actualFailedCount > 0 &&
             jobStatus.mode !== 'update' &&
             (jobStatus.status === 'completed' || jobStatus.status === 'failed' || jobStatus.status === 'paused' || jobStatus.status === 'cancelled') && (
              <div className="flex-1 flex flex-col gap-2">
                {/* Retry attempts info */}
                {jobStatus.retryAttempts !== undefined && jobStatus.retryAttempts > 0 && (
                  <div className="text-xs text-gray-600 dark:text-gray-400 px-2">
                    <span className="font-medium">Previous retry attempts:</span> {jobStatus.retryAttempts}
                    {jobStatus.lastRetryTimestamp && (
                      <span className="ml-2">
                        (Last: {new Date(jobStatus.lastRetryTimestamp).toLocaleString()})
                      </span>
                    )}
                  </div>
                )}

                {/* Retry button */}
                <button
                  onClick={() => retryFailedItems(jobId)}
                  disabled={isRetrying}
                  className="w-full py-2 px-4 bg-orange-600 hover:bg-orange-700 disabled:bg-orange-400 text-white rounded-md font-medium transition-colors disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {isRetrying ? (
                    <>
                      <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      Retrying...
                    </>
                  ) : (
                    <>
                      🔄 Retry {actualFailedCount.toLocaleString()} Failed Items
                    </>
                  )}
                </button>
              </div>
            )}

            {(jobStatus.status === 'completed' || jobStatus.status === 'failed' || jobStatus.status === 'paused' || jobStatus.status === 'cancelled') && (
              <button
                onClick={reset}
                className="flex-1 py-2 px-4 border border-gray-300 dark:border-gray-600 rounded-md font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                Start New Migration
              </button>
            )}
          </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Pause Button Component
 */
function PauseButton({ jobId }: { jobId: string }) {
  const [isPausing, setIsPausing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pauseElapsed, setPauseElapsed] = useState(0);

  // Timer for elapsed time display
  useEffect(() => {
    if (isPausing) {
      setPauseElapsed(0);
      const interval = setInterval(() => {
        setPauseElapsed(e => e + 1);
      }, 1000);
      return () => clearInterval(interval);
    } else {
      setPauseElapsed(0);
    }
  }, [isPausing]);

  const handlePause = async () => {
    setIsPausing(true);
    setError(null);

    try {
      const response = await fetch(`/api/migration/items/${jobId}/pause`, {
        method: 'POST',
      });

      const data = await response.json();

      if (!data.success) {
        setError(data.message || 'Failed to pause migration');
      }
    } catch (err) {
      setError('Error pausing migration');
      console.error('Failed to pause migration:', err);
    } finally {
      setIsPausing(false);
    }
  };

  return (
    <>
      <button
        onClick={handlePause}
        disabled={isPausing}
        className="flex-1 py-2 px-4 bg-red-600 hover:bg-red-700 disabled:bg-red-400 text-white rounded-md font-medium transition-colors disabled:cursor-not-allowed flex flex-col items-center justify-center gap-1"
      >
        {isPausing ? (
          <>
            <div className="flex items-center gap-2">
              <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              <span>Stopping... ({pauseElapsed}s)</span>
            </div>
            {pauseElapsed > 30 && (
              <span className="text-xs opacity-90">
                Waiting for current batch to complete...
              </span>
            )}
            {pauseElapsed > 120 && (
              <span className="text-xs opacity-90">
                Large migration may take up to 5 minutes to stop
              </span>
            )}
          </>
        ) : (
          <>
            ⏹️ Stop Migration
          </>
        )}
      </button>
      {error && (
        <div className="text-xs text-red-600 dark:text-red-400 mt-1">
          {error}
        </div>
      )}
    </>
  );
}

/**
 * Resume Button Component
 */
function ResumeButton({ jobId, resumption }: { jobId: string; resumption?: ResumptionConfig }) {
  const [isResuming, setIsResuming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleResume = async () => {
    setIsResuming(true);
    setError(null);

    try {
      const response = await fetch(`/api/migration/items/${jobId}/resume`, {
        method: 'POST',
      });

      const data = await response.json();

      if (!data.success) {
        setError(data.message || 'Failed to resume migration');
      }
    } catch (err) {
      setError('Error resuming migration');
      console.error('Failed to resume migration:', err);
    } finally {
      setIsResuming(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col gap-2">
      {/* Resumption context */}
      {resumption && (
        <div className="text-xs text-gray-600 dark:text-gray-400 px-2">
          <span className="font-medium">Resume from:</span>{' '}
          {resumption.lastProcessedItemId && (
            <span>Item ID {resumption.lastProcessedItemId}</span>
          )}
          {resumption.offset !== undefined && (
            <span className="ml-2">(offset: {resumption.offset})</span>
          )}
          {resumption.lastProcessedTimestamp && (
            <span className="ml-2">
              ({new Date(resumption.lastProcessedTimestamp).toLocaleString()})
            </span>
          )}
        </div>
      )}

      {/* Resume button */}
      <button
        onClick={handleResume}
        disabled={isResuming}
        className="w-full py-2 px-4 bg-green-600 hover:bg-green-700 disabled:bg-green-400 text-white rounded-md font-medium transition-colors disabled:cursor-not-allowed flex items-center justify-center gap-2"
      >
        {isResuming ? (
          <>
            <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            Resuming...
          </>
        ) : (
          <>
            ▶️ Resume Migration
          </>
        )}
      </button>

      {/* Error display */}
      {error && (
        <div className="text-xs text-red-600 dark:text-red-400">
          {error}
        </div>
      )}
    </div>
  );
}

/**
 * Past Migration Actions Component
 * Shows action buttons based on migration status
 */
function PastMigrationActions({
  migration,
  onView,
  onActionComplete,
}: {
  migration: MigrationListItem;
  onView: () => void;
  onActionComplete: () => void;
}) {
  const [isActing, setIsActing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAction = async (action: 'resume' | 'pause' | 'cancel') => {
    setIsActing(true);
    setError(null);

    try {
      const endpoint = action === 'cancel'
        ? `/api/migration/items/${migration.id}/pause`  // Cancel uses the same endpoint as pause
        : `/api/migration/items/${migration.id}/${action}`;

      const response = await fetch(endpoint, {
        method: 'POST',
      });

      const data = await response.json();

      if (!data.success) {
        setError(data.message || `Failed to ${action} migration`);
      } else {
        // Wait a moment for the status to update
        setTimeout(onActionComplete, 500);
      }
    } catch (err) {
      setError(`Error ${action}ing migration`);
      console.error(`Failed to ${action} migration:`, err);
    } finally {
      setIsActing(false);
    }
  };

  const handleRetry = async () => {
    setIsActing(true);
    setError(null);

    try {
      const response = await fetch(`/api/migration/items/${migration.id}/retry`, {
        method: 'POST',
      });

      const data = await response.json();

      if (!data.success) {
        setError(data.message || 'Failed to retry migration');
      } else {
        // Wait a moment for the retry to start
        setTimeout(onActionComplete, 500);
      }
    } catch (err) {
      setError('Error retrying migration');
      console.error('Failed to retry migration:', err);
    } finally {
      setIsActing(false);
    }
  };

  // Calculate failed count
  const failedCount = Math.max(
    migration.progress?.failed || 0,
    (migration as any).failedItems?.length || 0
  );

  return (
    <div className="flex gap-2 items-center">
      {/* View button - always visible */}
      <button
        onClick={onView}
        className="px-3 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
      >
        👁️ View
      </button>

      {/* Resume button - for paused migrations */}
      {migration.status === 'paused' && (
        <button
          onClick={() => handleAction('resume')}
          disabled={isActing}
          className="px-3 py-1 text-xs bg-green-600 hover:bg-green-700 disabled:bg-green-400 text-white rounded transition-colors disabled:cursor-not-allowed"
        >
          {isActing ? 'Resuming...' : '▶️ Resume'}
        </button>
      )}

      {/* Pause button - for in-progress migrations */}
      {migration.status === 'in_progress' && (
        <button
          onClick={() => handleAction('pause')}
          disabled={isActing}
          className="px-3 py-1 text-xs bg-red-600 hover:bg-red-700 disabled:bg-red-400 text-white rounded transition-colors disabled:cursor-not-allowed"
        >
          {isActing ? 'Stopping...' : '⏹️ Stop'}
        </button>
      )}

      {/* Retry button - for completed/failed/cancelled with failed items (not UPDATE mode) */}
      {failedCount > 0 &&
       (migration.metadata as any)?.mode !== 'update' &&
       (migration.status === 'completed' || migration.status === 'failed' || migration.status === 'cancelled') && (
        <button
          onClick={handleRetry}
          disabled={isActing}
          className="px-3 py-1 text-xs bg-orange-600 hover:bg-orange-700 disabled:bg-orange-400 text-white rounded transition-colors disabled:cursor-not-allowed"
        >
          {isActing ? 'Retrying...' : `🔄 Retry (${failedCount})`}
        </button>
      )}

      {/* Error display */}
      {error && (
        <span className="text-xs text-red-600 dark:text-red-400">
          {error}
        </span>
      )}
    </div>
  );
}

/**
 * Status Badge Component
 */
function StatusBadge({ status }: { status: string }) {
  const statusStyles: Record<string, string> = {
    in_progress: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
    completed: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
    failed: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
    paused: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
    planning: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200',
    cancelled: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200',
  };

  const statusLabels: Record<string, string> = {
    in_progress: 'In Progress',
    completed: 'Completed',
    failed: 'Failed',
    paused: 'Paused',
    planning: 'Planning',
    cancelled: 'Cancelled',
  };

  return (
    <span className={`text-xs px-2 py-0.5 rounded font-medium ${statusStyles[status] || statusStyles.planning}`}>
      {statusLabels[status] || status}
    </span>
  );
}
