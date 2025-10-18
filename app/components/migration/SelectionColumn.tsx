'use client';

import { SelectionDropdown } from './SelectionDropdown';
import { Organization, Space, Application } from '@/lib/podio/types';
import { MigrationSideSelection, SelectionLoadState } from '@/app/hooks/useMigrationSelection';

export interface SelectionColumnProps {
  title: string;
  selection: MigrationSideSelection;

  // Organizations
  organizations: Organization[];
  organizationsLoading: SelectionLoadState;
  organizationsError: string | null;
  onOrganizationChange: (org: Organization | null) => void;

  // Spaces
  spaces: Space[];
  spacesLoading: SelectionLoadState;
  spacesError: string | null;
  onSpaceChange: (space: Space | null) => void;

  // Apps
  apps: Application[];
  appsLoading: SelectionLoadState;
  appsError: string | null;
  onAppChange: (app: Application | null) => void;

  // Utilities
  onRetry?: () => void;
}

/**
 * Selection column component that displays cascading dropdowns
 * for organization -> workspace -> app selection
 */
export function SelectionColumn({
  title,
  selection,
  organizations,
  organizationsLoading,
  organizationsError,
  onOrganizationChange,
  spaces,
  spacesLoading,
  spacesError,
  onSpaceChange,
  apps,
  appsLoading,
  appsError,
  onAppChange,
  onRetry,
}: SelectionColumnProps) {
  return (
    <div className="flex flex-col space-y-4">
      {/* Column header */}
      <h3 className="text-lg font-semibold text-gray-900 dark:text-white border-b pb-2">
        {title}
      </h3>

      {/* Organization dropdown */}
      <SelectionDropdown
        label="Organization"
        value={selection.orgId}
        options={organizations}
        loading={organizationsLoading}
        error={organizationsError}
        placeholder="Select organization..."
        getOptionId={(org) => org.org_id}
        getOptionLabel={(org) => org.name}
        onChange={onOrganizationChange}
        onRetry={onRetry}
      />

      {/* Workspace (Space) dropdown */}
      <SelectionDropdown
        label="Workspace"
        value={selection.spaceId}
        options={spaces}
        loading={spacesLoading}
        error={spacesError}
        disabled={!selection.orgId}
        placeholder={selection.orgId ? "Select workspace..." : "Select organization first"}
        getOptionId={(space) => space.space_id}
        getOptionLabel={(space) => space.name}
        onChange={onSpaceChange}
        onRetry={onRetry}
      />

      {/* App dropdown */}
      <SelectionDropdown
        label="App"
        value={selection.appId}
        options={apps}
        loading={appsLoading}
        error={appsError}
        disabled={!selection.spaceId}
        placeholder={selection.spaceId ? "Select app..." : "Select workspace first"}
        getOptionId={(app) => app.app_id}
        getOptionLabel={(app) => app.config.name}
        onChange={onAppChange}
        onRetry={onRetry}
      />

      {/* Selection summary */}
      {selection.orgId && (
        <div className="mt-4 p-3 bg-gray-50 dark:bg-gray-800 rounded-md text-sm">
          <div className="font-medium text-gray-700 dark:text-gray-300 mb-2">Current Selection:</div>
          <div className="space-y-1 text-gray-600 dark:text-gray-400">
            {selection.orgName && <div>• Org: {selection.orgName}</div>}
            {selection.spaceName && <div>• Workspace: {selection.spaceName}</div>}
            {selection.appName && <div>• App: {selection.appName}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
