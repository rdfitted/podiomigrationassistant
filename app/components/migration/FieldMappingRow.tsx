'use client';

import React from 'react';
import { isReadOnlyTargetFieldType } from '@/lib/migration/items/field-mapping';

export interface AppFieldInfo {
  field_id: number;
  label: string;
  type: string;
  required?: boolean;
  external_id?: string;
}

export interface FieldMappingEntry {
  sourceFieldId: string;
  targetFieldId: string | null;
  sourceLabel: string;
  targetLabel: string | null;
  sourceType: string;
  targetType: string | null;
  hasTypeMismatch: boolean;
}

export interface FieldMappingRowProps {
  entry: FieldMappingEntry;
  targetFields: AppFieldInfo[];
  onMap: (sourceFieldId: string, targetFieldId: string) => void;
  onUnmap: (sourceFieldId: string) => void;
}

const FIELD_TYPE_ICONS: Record<string, string> = {
  // Text types
  text: 'T',

  // Numeric types
  number: '#',
  calculation: '∑',
  money: '$',
  progress: '▶',

  // Date/Time types
  date: '📅',
  duration: '⏱️',

  // Reference types
  app: '🔗',
  contact: '👤',

  // Organization types
  category: '📁',

  // Communication types
  email: '✉️',
  phone: '📞',

  // Location types
  location: '📍',

  // Media types
  image: '🖼️',
  video: '🎬',
  embed: '📺',

  // Other types
  link: '🌐',
  question: '❓',

  // Default fallback
  default: '?',
};

/**
 * Get tooltip text for type mismatch
 */
function getTypeMismatchTooltip(sourceType: string, targetType: string | null): string {
  if (!targetType) return 'Not mapped';
  if (sourceType === targetType) return 'Mapped - Types match';

  // Common safe mappings (note: calculation fields are read-only and excluded)
  const compatibleMappings = [
    { from: 'text', to: ['link'] },
    { from: 'number', to: ['money', 'progress'] },
    { from: 'date', to: ['duration'] },
    { from: 'calculation', to: ['text', 'number'] }, // Calculation values can be extracted to writable fields
  ];

  const isCompatible = compatibleMappings.some(
    m => m.from === sourceType && m.to.includes(targetType)
  );

  if (isCompatible) {
    return `Type mismatch (${sourceType} → ${targetType})\nThis mapping may work, but verify data compatibility`;
  }

  return `Type mismatch warning (${sourceType} → ${targetType})\nSource and target field types differ. Data may not transfer correctly.`;
}

/**
 * Individual field mapping row component
 */
export function FieldMappingRow({ entry, targetFields, onMap, onUnmap }: FieldMappingRowProps) {
  const typeMismatchTooltip = entry.hasTypeMismatch
    ? getTypeMismatchTooltip(entry.sourceType, entry.targetType)
    : entry.targetFieldId
    ? 'Mapped - Types match'
    : 'Not mapped';

  // Filter out read-only field types from target options
  // These field types cannot be written to via the API
  const writableTargetFields = targetFields.filter(
    (field) => !isReadOnlyTargetFieldType(field.type)
  );

  // Keyboard navigation handler for select
  const handleKeyDown = (e: React.KeyboardEvent<HTMLSelectElement>) => {
    if (e.key === 'Escape') {
      // Clear mapping on Escape
      if (entry.targetFieldId) {
        e.preventDefault();
        onUnmap(entry.sourceFieldId);
      }
    }
  };

  // Keyboard navigation handler for clear button
  const handleClearKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onUnmap(entry.sourceFieldId);
    }
  };

  const isCurrentTargetReadOnly =
    !!entry.targetFieldId &&
    targetFields.some(
      (field) =>
        field.field_id.toString() === entry.targetFieldId &&
        isReadOnlyTargetFieldType(field.type)
    );

  return (
    <div className="grid grid-cols-12 gap-2 p-2 border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800">
      {/* Source field */}
      <div className="col-span-5 flex items-center gap-2">
        <span className="flex-shrink-0 w-6 h-6 bg-gray-100 dark:bg-gray-700 rounded flex items-center justify-center text-xs font-medium" title={`Type: ${entry.sourceType}`}>
          {FIELD_TYPE_ICONS[entry.sourceType] || FIELD_TYPE_ICONS.default}
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-gray-900 dark:text-white truncate" title={entry.sourceLabel}>
            {entry.sourceLabel}
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400">{entry.sourceType}</div>
        </div>
      </div>

      {/* Mapping status indicator */}
      <div className="col-span-1 flex items-center justify-center">
        {isCurrentTargetReadOnly ? (
          <span className="text-red-500 cursor-help" title="Read-only field: This field cannot be updated via the API. Please map to a writable field.">
            🚫
          </span>
        ) : entry.hasTypeMismatch ? (
          <span className="text-yellow-500 cursor-help" title={typeMismatchTooltip}>
            ⚠️
          </span>
        ) : entry.targetFieldId ? (
          <span className="text-green-500 cursor-help" title={typeMismatchTooltip}>
            ✓
          </span>
        ) : (
          <span className="text-gray-300 dark:text-gray-600 cursor-help" title={typeMismatchTooltip}>
            →
          </span>
        )}
      </div>

      {/* Target field selector */}
      <div className="col-span-5">
        <select
          value={entry.targetFieldId || ''}
          onChange={(e) => {
            if (e.target.value) {
              onMap(entry.sourceFieldId, e.target.value);
            }
          }}
          onKeyDown={handleKeyDown}
          className={`w-full px-2 py-1.5 text-sm border rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 ${
            isCurrentTargetReadOnly ? 'border-red-300 dark:border-red-700 ring-1 ring-red-500' : 'border-gray-300 dark:border-gray-600'
          }`}
          aria-label={`Map ${entry.sourceLabel} to target field`}
        >
          <option value="">-- Select target field --</option>
          <optgroup label="Writable Fields">
            {writableTargetFields.map((tf) => (
              <option key={tf.field_id} value={tf.field_id.toString()}>
                {tf.label} ({tf.type})
              </option>
            ))}
          </optgroup>
          <optgroup label="Read-only Fields (Cannot Map)">
            {targetFields
              .filter((field) => isReadOnlyTargetFieldType(field.type))
              .map((tf) => (
                <option key={tf.field_id} value={tf.field_id.toString()} disabled>
                  {tf.label} ({tf.type}) - Read-only
                </option>
              ))}
          </optgroup>
        </select>
        {isCurrentTargetReadOnly && (
          <p className="mt-1 text-[10px] text-red-600 dark:text-red-400">
            Target field is read-only and will be skipped during migration.
          </p>
        )}
      </div>

      {/* Actions */}
      <div className="col-span-1 flex items-center justify-end">
        {entry.targetFieldId && (
          <button
            onClick={() => onUnmap(entry.sourceFieldId)}
            onKeyDown={handleClearKeyDown}
            className="text-gray-400 hover:text-red-600 dark:hover:text-red-400 p-1 focus:outline-none focus:ring-2 focus:ring-red-500 rounded"
            title="Clear mapping (or press Escape in select)"
            aria-label={`Clear mapping for ${entry.sourceLabel}`}
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
}
