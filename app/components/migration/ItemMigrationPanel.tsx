'use client';

import React, { useState, useEffect } from 'react';
import { useItemMigration } from '@/app/hooks/useItemMigration';
import { ItemMigrationProgress } from './ItemMigrationProgress';
import { FieldMappingEditor } from './FieldMappingEditor';
import { AppFieldInfo } from './FieldMappingRow';

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
  const [showFieldMapping, setShowFieldMapping] = useState(false);
  const [showPastMigrations, setShowPastMigrations] = useState(false);
  const [pastMigrations, setPastMigrations] = useState<MigrationListItem[]>([]);
  const [isLoadingMigrations, setIsLoadingMigrations] = useState(false);

  // Field structures for dropdowns
  const [sourceFields, setSourceFields] = useState<AppFieldInfo[]>([]);
  const [targetFields, setTargetFields] = useState<AppFieldInfo[]>([]);
  const [isLoadingFields, setIsLoadingFields] = useState(false);

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

  // Fetch past migrations when component mounts or when past migrations panel is opened
  useEffect(() => {
    async function loadPastMigrations() {
      if (!showPastMigrations) return;

      setIsLoadingMigrations(true);
      try {
        const response = await fetch('/api/migration/items');
        if (response.ok) {
          const data = await response.json();
          setPastMigrations(data.migrations || []);
        }
      } catch (err) {
        console.error('Failed to load past migrations:', err);
      } finally {
        setIsLoadingMigrations(false);
      }
    }

    loadPastMigrations();
  }, [showPastMigrations]);

  const handleLoadMigration = async (migrationId: string) => {
    await loadMigration(migrationId);
    setShowPastMigrations(false);
  };

  const handleStartMigration = async () => {
    await startMigration({
      mode,
      sourceMatchField: sourceMatchField || undefined,
      targetMatchField: targetMatchField || undefined,
      duplicateBehavior,
      batchSize,
      concurrency,
      stopOnError: false,
      maxItems,
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
              {pastMigrations.length > 0 && (
                <span className="text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 px-2 py-0.5 rounded">
                  {pastMigrations.length}
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
                <div className="space-y-2">
                  {pastMigrations.map((migration) => (
                    <div
                      key={migration.id}
                      className="p-3 border border-gray-200 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer"
                      onClick={() => handleLoadMigration(migration.id)}
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
                        <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5">
                          <div
                            className="bg-blue-600 h-1.5 rounded-full transition-all"
                            style={{ width: `${migration.progress.percent}%` }}
                          />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
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
                  <span className="text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 px-2 py-0.5 rounded">
                    Auto
                  </span>
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

          <button
            onClick={handleStartMigration}
            disabled={!canStart}
            className={`w-full py-2 px-4 rounded-md font-medium transition-colors ${
              canStart
                ? 'bg-blue-600 hover:bg-blue-700 text-white'
                : 'bg-gray-300 dark:bg-gray-700 text-gray-500 dark:text-gray-400 cursor-not-allowed'
            }`}
          >
            {isCreating ? 'Starting Migration...' : 'Start Item Migration'}
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

      {/* Progress Display */}
      {jobId && jobStatus && (
        <div className="mt-4">
          <ItemMigrationProgress jobStatus={jobStatus} isActive={isActive} />

          {/* Pause/Resume/Retry/Reset Controls */}
          <div className="mt-4 flex gap-2">
            {jobStatus.status === 'in_progress' && (
              <PauseButton jobId={jobId} />
            )}

            {jobStatus.status === 'paused' && (
              <ResumeButton jobId={jobId} />
            )}

            {/* Retry Failed Items Button - Show when there are failed items */}
            {jobId && jobStatus.progress && jobStatus.progress.failed > 0 &&
             (jobStatus.status === 'completed' || jobStatus.status === 'failed' || jobStatus.status === 'paused') && (
              <button
                onClick={() => retryFailedItems(jobId)}
                disabled={isRetrying}
                className="flex-1 py-2 px-4 bg-orange-600 hover:bg-orange-700 disabled:bg-orange-400 text-white rounded-md font-medium transition-colors disabled:cursor-not-allowed flex items-center justify-center gap-2"
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
                    🔄 Retry {jobStatus.progress.failed} Failed Items
                  </>
                )}
              </button>
            )}

            {(jobStatus.status === 'completed' || jobStatus.status === 'failed' || jobStatus.status === 'paused') && (
              <button
                onClick={reset}
                className="flex-1 py-2 px-4 border border-gray-300 dark:border-gray-600 rounded-md font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                Start New Migration
              </button>
            )}
          </div>
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
        className="flex-1 py-2 px-4 bg-yellow-600 hover:bg-yellow-700 disabled:bg-yellow-400 text-white rounded-md font-medium transition-colors disabled:cursor-not-allowed flex items-center justify-center gap-2"
      >
        {isPausing ? (
          <>
            <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            Pausing...
          </>
        ) : (
          <>
            ⏸️ Pause Migration
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
function ResumeButton({ jobId }: { jobId: string }) {
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
    <>
      <button
        onClick={handleResume}
        disabled={isResuming}
        className="flex-1 py-2 px-4 bg-green-600 hover:bg-green-700 disabled:bg-green-400 text-white rounded-md font-medium transition-colors disabled:cursor-not-allowed flex items-center justify-center gap-2"
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
      {error && (
        <div className="text-xs text-red-600 dark:text-red-400 mt-1">
          {error}
        </div>
      )}
    </>
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
  };

  const statusLabels: Record<string, string> = {
    in_progress: 'In Progress',
    completed: 'Completed',
    failed: 'Failed',
    paused: 'Paused',
    planning: 'Planning',
  };

  return (
    <span className={`text-xs px-2 py-0.5 rounded font-medium ${statusStyles[status] || statusStyles.planning}`}>
      {statusLabels[status] || status}
    </span>
  );
}
