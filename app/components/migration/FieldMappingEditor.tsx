'use client';

import React, { useState, useEffect } from 'react';
import { FieldMapping } from '@/lib/migration/items/types';
import { FieldMappingHeader } from './FieldMappingHeader';
import { FieldMappingRow, AppFieldInfo, FieldMappingEntry } from './FieldMappingRow';

export interface FieldMappingEditorProps {
  sourceAppId: number;
  targetAppId: number;
  initialMapping?: FieldMapping;
  onMappingChange: (mapping: FieldMapping) => void;
}

interface FieldMappingEditorState {
  sourceFields: AppFieldInfo[];
  targetFields: AppFieldInfo[];
  mapping: FieldMapping;
  isLoading: boolean;
  error: string | null;
}

/**
 * Field mapping editor component
 * Allows users to manually map source fields to target fields
 */
export function FieldMappingEditor({
  sourceAppId,
  targetAppId,
  initialMapping,
  onMappingChange,
}: FieldMappingEditorProps) {
  const [state, setState] = useState<FieldMappingEditorState>({
    sourceFields: [],
    targetFields: [],
    mapping: initialMapping || {},
    isLoading: true,
    error: null,
  });

  // Fetch app structures on mount or when app IDs change
  useEffect(() => {
    async function loadFields() {
      if (!sourceAppId || !targetAppId) {
        setState((s) => ({ ...s, isLoading: false }));
        return;
      }

      try {
        setState((s) => ({ ...s, isLoading: true, error: null }));

        const [sourceResponse, targetResponse] = await Promise.all([
          fetch(`/api/podio/apps/${sourceAppId}/structure`),
          fetch(`/api/podio/apps/${targetAppId}/structure`),
        ]);

        if (!sourceResponse.ok || !targetResponse.ok) {
          throw new Error('Failed to load app structures');
        }

        const [sourceApp, targetApp] = await Promise.all([
          sourceResponse.json(),
          targetResponse.json(),
        ]);

        setState((s) => ({
          ...s,
          sourceFields: sourceApp.fields || [],
          targetFields: targetApp.fields || [],
          isLoading: false,
        }));
      } catch (error) {
        setState((s) => ({
          ...s,
          isLoading: false,
          error: error instanceof Error ? error.message : 'Failed to load fields',
        }));
      }
    }

    loadFields();
  }, [sourceAppId, targetAppId]);

  const handleMap = (sourceFieldId: string, targetFieldId: string) => {
    const newMapping = { ...state.mapping, [sourceFieldId]: targetFieldId };
    setState((s) => ({ ...s, mapping: newMapping }));
    onMappingChange(newMapping);
  };

  const handleUnmap = (sourceFieldId: string) => {
    const newMapping = { ...state.mapping };
    delete newMapping[sourceFieldId];
    setState((s) => ({ ...s, mapping: newMapping }));
    onMappingChange(newMapping);
  };

  const handleResetToAuto = async () => {
    try {
      const response = await fetch('/api/migration/items/field-mapping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceAppId, targetAppId }),
      });

      if (!response.ok) {
        throw new Error('Failed to generate auto-mapping');
      }

      const { fieldMapping } = await response.json();
      setState((s) => ({ ...s, mapping: fieldMapping }));
      onMappingChange(fieldMapping);
    } catch (error) {
      console.error('Failed to reset to auto mapping:', error);
    }
  };

  // Build mapping entries for display
  const mappingEntries: FieldMappingEntry[] = state.sourceFields.map((sf) => {
    const targetFieldId = state.mapping[sf.field_id.toString()];
    const targetField = state.targetFields.find((tf) => tf.field_id.toString() === targetFieldId);

    return {
      sourceFieldId: sf.field_id.toString(),
      targetFieldId: targetFieldId || null,
      sourceLabel: sf.label,
      targetLabel: targetField?.label || null,
      sourceType: sf.type,
      targetType: targetField?.type || null,
      hasTypeMismatch: targetField ? targetField.type !== sf.type : false,
    };
  });

  const mappedCount = Object.keys(state.mapping).length;

  if (state.isLoading) {
    return (
      <div className="text-center py-8 text-gray-500 dark:text-gray-400">
        <div className="animate-pulse">Loading fields...</div>
      </div>
    );
  }

  if (state.error) {
    return (
      <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md text-red-800 dark:text-red-300">
        {state.error}
      </div>
    );
  }

  if (state.sourceFields.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500 dark:text-gray-400">
        No fields found in source app
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header with stats and controls */}
      <div className="flex justify-between items-center">
        <div className="text-sm text-gray-600 dark:text-gray-400">
          {mappedCount} of {state.sourceFields.length} fields mapped
        </div>
        <button
          onClick={handleResetToAuto}
          className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
          type="button"
        >
          Reset to Auto
        </button>
      </div>

      {/* Mapping table */}
      <div className="max-h-96 overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-md">
        <FieldMappingHeader />
        {mappingEntries.map((entry) => (
          <FieldMappingRow
            key={entry.sourceFieldId}
            entry={entry}
            targetFields={state.targetFields}
            onMap={handleMap}
            onUnmap={handleUnmap}
          />
        ))}
      </div>
    </div>
  );
}
