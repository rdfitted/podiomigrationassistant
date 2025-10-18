'use client';

import { SelectionLoadState } from '@/app/hooks/useMigrationSelection';

export interface SelectionDropdownProps<T> {
  label: string;
  value: number | undefined;
  options: T[];
  loading: SelectionLoadState;
  error: string | null;
  disabled?: boolean;
  placeholder?: string;
  getOptionId: (option: T) => number;
  getOptionLabel: (option: T) => string;
  onChange: (option: T | null) => void;
  onRetry?: () => void;
}

/**
 * Reusable dropdown component for organization/space/app selection
 * Supports loading states, error handling, and search filtering
 */
export function SelectionDropdown<T>({
  label,
  value,
  options,
  loading,
  error,
  disabled = false,
  placeholder = 'Select...',
  getOptionId,
  getOptionLabel,
  onChange,
  onRetry,
}: SelectionDropdownProps<T>) {
  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const selectedId = parseInt(e.target.value, 10);
    if (isNaN(selectedId)) {
      onChange(null);
    } else {
      const selectedOption = options.find(opt => getOptionId(opt) === selectedId);
      onChange(selectedOption || null);
    }
  };

  const isDisabled = disabled || loading === 'loading';

  return (
    <div className="flex flex-col space-y-1">
      <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
        {label}
      </label>

      {loading === 'loading' && (
        <div className="flex items-center space-x-2 text-sm text-gray-500">
          <svg
            className="animate-spin h-4 w-4"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
          <span>Loading...</span>
        </div>
      )}

      {loading === 'error' && error && (
        <div className="flex items-center justify-between p-2 text-sm text-red-600 bg-red-50 dark:bg-red-900/20 dark:text-red-400 rounded">
          <span>{error}</span>
          {onRetry && (
            <button
              onClick={onRetry}
              className="text-xs font-medium underline hover:no-underline"
            >
              Retry
            </button>
          )}
        </div>
      )}

      <select
        value={value || ''}
        onChange={handleChange}
        disabled={isDisabled}
        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed dark:bg-gray-800 dark:text-white"
      >
        <option value="">{placeholder}</option>
        {options.map(option => (
          <option key={getOptionId(option)} value={getOptionId(option)}>
            {getOptionLabel(option)}
          </option>
        ))}
      </select>

      {loading === 'ready' && options.length === 0 && (
        <p className="text-xs text-gray-500 dark:text-gray-400">No options available</p>
      )}
    </div>
  );
}
