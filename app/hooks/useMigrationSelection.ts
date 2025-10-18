'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { fetchOrganizations, fetchSpaces, fetchApps, PodioClientError } from '@/lib/podio/client';
import { Organization, Space, Application } from '@/lib/podio/types';

/**
 * Selection state for one side (source or destination)
 */
export interface MigrationSideSelection {
  orgId?: number;
  spaceId?: number;
  appId?: number;
  orgName?: string;
  spaceName?: string;
  appName?: string;
}

/**
 * Complete migration selection state
 */
export interface MigrationSelectionState {
  source: MigrationSideSelection;
  destination: MigrationSideSelection;
  lastUpdated?: string;
}

/**
 * Load state for tracking fetch operations
 */
export type SelectionLoadState = 'idle' | 'loading' | 'ready' | 'error';

/**
 * Hook return type
 */
export interface UseMigrationSelectionReturn {
  // State
  source: MigrationSideSelection;
  destination: MigrationSideSelection;

  // Organizations
  organizations: Organization[];
  organizationsLoading: SelectionLoadState;
  organizationsError: string | null;

  // Source spaces
  sourceSpaces: Space[];
  sourceSpacesLoading: SelectionLoadState;
  sourceSpacesError: string | null;

  // Source apps
  sourceApps: Application[];
  sourceAppsLoading: SelectionLoadState;
  sourceAppsError: string | null;

  // Destination spaces
  destinationSpaces: Space[];
  destinationSpacesLoading: SelectionLoadState;
  destinationSpacesError: string | null;

  // Destination apps
  destinationApps: Application[];
  destinationAppsLoading: SelectionLoadState;
  destinationAppsError: string | null;

  // Actions
  setSourceOrg: (org: Organization | null) => void;
  setSourceSpace: (space: Space | null) => void;
  setSourceApp: (app: Application | null) => void;
  setDestinationOrg: (org: Organization | null) => void;
  setDestinationSpace: (space: Space | null) => void;
  setDestinationApp: (app: Application | null) => void;

  // Utilities
  refresh: () => void;
  isComplete: boolean;
  hasErrors: boolean;
}

const STORAGE_KEY = 'podio-migration-selection';

/**
 * Custom hook for managing migration selection state
 * Handles cascading dropdowns, persistence, and data fetching
 */
export function useMigrationSelection(): UseMigrationSelectionReturn {
  // Selection state
  const [source, setSource] = useState<MigrationSideSelection>({});
  const [destination, setDestination] = useState<MigrationSideSelection>({});

  // Organizations (shared between source and destination)
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [organizationsLoading, setOrganizationsLoading] = useState<SelectionLoadState>('idle');
  const [organizationsError, setOrganizationsError] = useState<string | null>(null);

  // Source spaces
  const [sourceSpaces, setSourceSpaces] = useState<Space[]>([]);
  const [sourceSpacesLoading, setSourceSpacesLoading] = useState<SelectionLoadState>('idle');
  const [sourceSpacesError, setSourceSpacesError] = useState<string | null>(null);

  // Source apps
  const [sourceApps, setSourceApps] = useState<Application[]>([]);
  const [sourceAppsLoading, setSourceAppsLoading] = useState<SelectionLoadState>('idle');
  const [sourceAppsError, setSourceAppsError] = useState<string | null>(null);

  // Destination spaces
  const [destinationSpaces, setDestinationSpaces] = useState<Space[]>([]);
  const [destinationSpacesLoading, setDestinationSpacesLoading] = useState<SelectionLoadState>('idle');
  const [destinationSpacesError, setDestinationSpacesError] = useState<string | null>(null);

  // Destination apps
  const [destinationApps, setDestinationApps] = useState<Application[]>([]);
  const [destinationAppsLoading, setDestinationAppsLoading] = useState<SelectionLoadState>('idle');
  const [destinationAppsError, setDestinationAppsError] = useState<string | null>(null);

  // Load organizations on mount
  useEffect(() => {
    loadOrganizations();
    // Restore from localStorage
    restoreFromStorage();
  }, []);

  // Persist to localStorage whenever selections change
  useEffect(() => {
    if (source.orgId || destination.orgId) {
      persistToStorage({ source, destination, lastUpdated: new Date().toISOString() });
    }
  }, [source, destination]);

  // Load source spaces when source org changes
  useEffect(() => {
    if (source.orgId) {
      loadSourceSpaces(source.orgId);
    } else {
      setSourceSpaces([]);
      setSourceSpacesLoading('idle');
    }
  }, [source.orgId]);

  // Load source apps when source space changes
  useEffect(() => {
    if (source.spaceId) {
      loadSourceApps(source.spaceId);
    } else {
      setSourceApps([]);
      setSourceAppsLoading('idle');
    }
  }, [source.spaceId]);

  // Load destination spaces when destination org changes
  useEffect(() => {
    if (destination.orgId) {
      loadDestinationSpaces(destination.orgId);
    } else {
      setDestinationSpaces([]);
      setDestinationSpacesLoading('idle');
    }
  }, [destination.orgId]);

  // Load destination apps when destination space changes
  useEffect(() => {
    if (destination.spaceId) {
      loadDestinationApps(destination.spaceId);
    } else {
      setDestinationApps([]);
      setDestinationAppsLoading('idle');
    }
  }, [destination.spaceId]);

  /**
   * Load organizations
   */
  const loadOrganizations = async () => {
    setOrganizationsLoading('loading');
    setOrganizationsError(null);
    try {
      const orgs = await fetchOrganizations();
      setOrganizations(orgs);
      setOrganizationsLoading('ready');
    } catch (error) {
      console.error('Error loading organizations:', error);
      setOrganizationsError(error instanceof PodioClientError ? error.message : 'Failed to load organizations');
      setOrganizationsLoading('error');
    }
  };

  /**
   * Load source spaces
   */
  const loadSourceSpaces = async (orgId: number) => {
    setSourceSpacesLoading('loading');
    setSourceSpacesError(null);
    try {
      const spaces = await fetchSpaces(orgId);
      setSourceSpaces(spaces);
      setSourceSpacesLoading('ready');
    } catch (error) {
      console.error('Error loading source spaces:', error);
      setSourceSpacesError(error instanceof PodioClientError ? error.message : 'Failed to load spaces');
      setSourceSpacesLoading('error');
    }
  };

  /**
   * Load source apps
   */
  const loadSourceApps = async (spaceId: number) => {
    setSourceAppsLoading('loading');
    setSourceAppsError(null);
    try {
      const apps = await fetchApps(spaceId);
      setSourceApps(apps);
      setSourceAppsLoading('ready');
    } catch (error) {
      console.error('Error loading source apps:', error);
      setSourceAppsError(error instanceof PodioClientError ? error.message : 'Failed to load apps');
      setSourceAppsLoading('error');
    }
  };

  /**
   * Load destination spaces
   */
  const loadDestinationSpaces = async (orgId: number) => {
    setDestinationSpacesLoading('loading');
    setDestinationSpacesError(null);
    try {
      const spaces = await fetchSpaces(orgId);
      setDestinationSpaces(spaces);
      setDestinationSpacesLoading('ready');
    } catch (error) {
      console.error('Error loading destination spaces:', error);
      setDestinationSpacesError(error instanceof PodioClientError ? error.message : 'Failed to load spaces');
      setDestinationSpacesLoading('error');
    }
  };

  /**
   * Load destination apps
   */
  const loadDestinationApps = async (spaceId: number) => {
    setDestinationAppsLoading('loading');
    setDestinationAppsError(null);
    try {
      const apps = await fetchApps(spaceId);
      setDestinationApps(apps);
      setDestinationAppsLoading('ready');
    } catch (error) {
      console.error('Error loading destination apps:', error);
      setDestinationAppsError(error instanceof PodioClientError ? error.message : 'Failed to load apps');
      setDestinationAppsLoading('error');
    }
  };

  /**
   * Set source organization (clears downstream selections)
   */
  const setSourceOrg = useCallback((org: Organization | null) => {
    if (org) {
      setSource({ orgId: org.org_id, orgName: org.name });
    } else {
      setSource({});
    }
  }, []);

  /**
   * Set source space (clears downstream selections)
   */
  const setSourceSpace = useCallback((space: Space | null) => {
    if (space) {
      setSource(prev => ({ ...prev, spaceId: space.space_id, spaceName: space.name, appId: undefined, appName: undefined }));
    } else {
      setSource(prev => ({ orgId: prev.orgId, orgName: prev.orgName }));
    }
  }, []);

  /**
   * Set source app
   */
  const setSourceApp = useCallback((app: Application | null) => {
    if (app) {
      setSource(prev => ({ ...prev, appId: app.app_id, appName: app.config.name }));
    } else {
      setSource(prev => ({ orgId: prev.orgId, orgName: prev.orgName, spaceId: prev.spaceId, spaceName: prev.spaceName }));
    }
  }, []);

  /**
   * Set destination organization (clears downstream selections)
   */
  const setDestinationOrg = useCallback((org: Organization | null) => {
    if (org) {
      setDestination({ orgId: org.org_id, orgName: org.name });
    } else {
      setDestination({});
    }
  }, []);

  /**
   * Set destination space (clears downstream selections)
   */
  const setDestinationSpace = useCallback((space: Space | null) => {
    if (space) {
      setDestination(prev => ({ ...prev, spaceId: space.space_id, spaceName: space.name, appId: undefined, appName: undefined }));
    } else {
      setDestination(prev => ({ orgId: prev.orgId, orgName: prev.orgName }));
    }
  }, []);

  /**
   * Set destination app
   */
  const setDestinationApp = useCallback((app: Application | null) => {
    if (app) {
      setDestination(prev => ({ ...prev, appId: app.app_id, appName: app.config.name }));
    } else {
      setDestination(prev => ({ orgId: prev.orgId, orgName: prev.orgName, spaceId: prev.spaceId, spaceName: prev.spaceName }));
    }
  }, []);

  /**
   * Refresh all data
   */
  const refresh = useCallback(() => {
    loadOrganizations();
    if (source.orgId) loadSourceSpaces(source.orgId);
    if (source.spaceId) loadSourceApps(source.spaceId);
    if (destination.orgId) loadDestinationSpaces(destination.orgId);
    if (destination.spaceId) loadDestinationApps(destination.spaceId);
  }, [source.orgId, source.spaceId, destination.orgId, destination.spaceId]);

  /**
   * Persist state to localStorage
   */
  const persistToStorage = (state: MigrationSelectionState) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
      console.error('Failed to persist migration selection:', error);
    }
  };

  /**
   * Restore state from localStorage
   */
  const restoreFromStorage = () => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const state: MigrationSelectionState = JSON.parse(stored);
        // Only restore if not too old (7 days)
        if (state.lastUpdated) {
          const age = Date.now() - new Date(state.lastUpdated).getTime();
          if (age < 7 * 24 * 60 * 60 * 1000) {
            setSource(state.source);
            setDestination(state.destination);
          }
        }
      }
    } catch (error) {
      console.error('Failed to restore migration selection:', error);
    }
  };

  /**
   * Check if all selections are complete
   */
  const isComplete = useMemo(() => {
    return !!(
      source.orgId && source.spaceId && source.appId &&
      destination.orgId && destination.spaceId && destination.appId
    );
  }, [source, destination]);

  /**
   * Check if there are any errors
   */
  const hasErrors = useMemo(() => {
    return !!(
      organizationsError ||
      sourceSpacesError ||
      sourceAppsError ||
      destinationSpacesError ||
      destinationAppsError
    );
  }, [organizationsError, sourceSpacesError, sourceAppsError, destinationSpacesError, destinationAppsError]);

  return {
    // State
    source,
    destination,

    // Organizations
    organizations,
    organizationsLoading,
    organizationsError,

    // Source
    sourceSpaces,
    sourceSpacesLoading,
    sourceSpacesError,
    sourceApps,
    sourceAppsLoading,
    sourceAppsError,

    // Destination
    destinationSpaces,
    destinationSpacesLoading,
    destinationSpacesError,
    destinationApps,
    destinationAppsLoading,
    destinationAppsError,

    // Actions
    setSourceOrg,
    setSourceSpace,
    setSourceApp,
    setDestinationOrg,
    setDestinationSpace,
    setDestinationApp,

    // Utilities
    refresh,
    isComplete,
    hasErrors,
  };
}
