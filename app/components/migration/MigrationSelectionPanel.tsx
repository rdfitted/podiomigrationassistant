'use client';

import React, { useState, useEffect } from 'react';
import { useMigrationSelection, MigrationSelectionState } from '@/app/hooks/useMigrationSelection';
import { SelectionColumn } from './SelectionColumn';
import { FlowClonePanel } from './FlowClonePanel';
import { ItemMigrationPanel } from './ItemMigrationPanel';
import { TabContainer, MigrationTabType } from './TabContainer';

export interface MigrationSelectionPanelProps {
  onSelectionChange?: (state: MigrationSelectionState) => void;
}

/**
 * Main migration selection panel component
 * Displays source and destination selection columns
 */
export function MigrationSelectionPanel({ onSelectionChange }: MigrationSelectionPanelProps) {
  // Tab state
  const [activeTab, setActiveTab] = useState<MigrationTabType>('items');

  // Badge counts for tabs
  const [flowsCount, setFlowsCount] = useState<number | undefined>(undefined);
  const [itemsCount, setItemsCount] = useState<number | undefined>(undefined);

  const {
    source,
    destination,
    organizations,
    organizationsLoading,
    organizationsError,
    sourceSpaces,
    sourceSpacesLoading,
    sourceSpacesError,
    sourceApps,
    sourceAppsLoading,
    sourceAppsError,
    destinationSpaces,
    destinationSpacesLoading,
    destinationSpacesError,
    destinationApps,
    destinationAppsLoading,
    destinationAppsError,
    setSourceOrg,
    setSourceSpace,
    setSourceApp,
    setDestinationOrg,
    setDestinationSpace,
    setDestinationApp,
    refresh,
    isComplete,
    hasErrors,
  } = useMigrationSelection();

  // Notify parent of selection changes
  React.useEffect(() => {
    if (onSelectionChange) {
      onSelectionChange({
        source,
        destination,
        lastUpdated: new Date().toISOString(),
      });
    }
  }, [source, destination, onSelectionChange]);

  // Fetch flows count when source app changes
  useEffect(() => {
    if (!source.appId) {
      setFlowsCount(undefined);
      return;
    }

    async function fetchFlowsCount() {
      try {
        const response = await fetch(`/api/globiflow/apps/${source.appId}/flows`);
        const data = await response.json();

        if (data.success && Array.isArray(data.data)) {
          setFlowsCount(data.data.length);
        }
      } catch (error) {
        console.error('Failed to fetch flows count:', error);
        setFlowsCount(undefined);
      }
    }

    fetchFlowsCount();
  }, [source.appId]);

  // Fetch items count when source app changes
  useEffect(() => {
    if (!source.appId) {
      setItemsCount(undefined);
      return;
    }

    async function fetchItemsCount() {
      try {
        const response = await fetch(`/api/podio/apps/${source.appId}/items/count`);
        const data = await response.json();

        if (typeof data.count === 'number') {
          setItemsCount(data.count);
        }
      } catch (error) {
        console.error('Failed to fetch items count:', error);
        setItemsCount(undefined);
      }
    }

    fetchItemsCount();
  }, [source.appId]);

  return (
    <div className="w-full h-full flex-shrink-0 border-l border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 flex flex-col">
      <div className="flex-1 overflow-y-auto p-6">
        {/* Panel header */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">
            Migration Setup
          </h2>
          <button
            onClick={refresh}
            className="p-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800"
            title="Refresh all data"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>

        {/* Configuration check */}
        {organizationsLoading === 'error' && organizationsError?.includes('not configured') && (
          <div className="mb-6 p-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-md">
            <div className="flex items-start">
              <svg className="w-5 h-5 text-yellow-600 dark:text-yellow-400 mt-0.5 mr-3" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              <div>
                <h3 className="text-sm font-medium text-yellow-800 dark:text-yellow-300">
                  Podio Not Configured
                </h3>
                <div className="mt-2 text-sm text-yellow-700 dark:text-yellow-400">
                  <p>Please configure your Podio credentials in <code className="bg-yellow-100 dark:bg-yellow-900/40 px-1 py-0.5 rounded">.env.local</code>:</p>
                  <ul className="list-disc list-inside mt-2 space-y-1">
                    <li>PODIO_CLIENT_ID</li>
                    <li>PODIO_CLIENT_SECRET</li>
                    <li>PODIO_USERNAME</li>
                    <li>PODIO_PASSWORD</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Source column */}
        <div className="mb-8">
          <SelectionColumn
            title="Source"
            selection={source}
            organizations={organizations}
            organizationsLoading={organizationsLoading}
            organizationsError={organizationsError}
            onOrganizationChange={setSourceOrg}
            spaces={sourceSpaces}
            spacesLoading={sourceSpacesLoading}
            spacesError={sourceSpacesError}
            onSpaceChange={setSourceSpace}
            apps={sourceApps}
            appsLoading={sourceAppsLoading}
            appsError={sourceAppsError}
            onAppChange={setSourceApp}
            onRetry={refresh}
          />
        </div>

        {/* Divider */}
        <div className="flex items-center my-8">
          <div className="flex-1 border-t border-gray-300 dark:border-gray-700"></div>
          <svg className="w-6 h-6 mx-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
          </svg>
          <div className="flex-1 border-t border-gray-300 dark:border-gray-700"></div>
        </div>

        {/* Destination column */}
        <div className="mb-8">
          <SelectionColumn
            title="Destination"
            selection={destination}
            organizations={organizations}
            organizationsLoading={organizationsLoading}
            organizationsError={organizationsError}
            onOrganizationChange={setDestinationOrg}
            spaces={destinationSpaces}
            spacesLoading={destinationSpacesLoading}
            spacesError={destinationSpacesError}
            onSpaceChange={setDestinationSpace}
            apps={destinationApps}
            appsLoading={destinationAppsLoading}
            appsError={destinationAppsError}
            onAppChange={setDestinationApp}
            onRetry={refresh}
          />
        </div>

        {/* Status indicator */}
        {isComplete && (
          <div className="mt-6 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-md">
            <div className="flex items-center">
              <svg className="w-5 h-5 text-green-600 dark:text-green-400 mr-2" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <span className="text-sm font-medium text-green-800 dark:text-green-300">
                Migration path configured
              </span>
            </div>
          </div>
        )}

        {hasErrors && !organizationsError?.includes('not configured') && (
          <div className="mt-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md">
            <div className="flex items-center">
              <svg className="w-5 h-5 text-red-600 dark:text-red-400 mr-2" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
              </svg>
              <span className="text-sm font-medium text-red-800 dark:text-red-300">
                Some selections failed to load
              </span>
            </div>
          </div>
        )}

        {/* Tabbed Migration Tools */}
        <TabContainer
          activeTab={activeTab}
          onTabChange={setActiveTab}
          tabs={[
            { id: 'flows', label: 'Flow Migration', badge: flowsCount },
            { id: 'items', label: 'Item Migration', badge: itemsCount },
          ]}
        >
          {activeTab === 'flows' && (
            <FlowClonePanel
              sourceAppId={source.appId}
              targetAppId={destination.appId}
            />
          )}
          {activeTab === 'items' && (
            <ItemMigrationPanel
              sourceAppId={source.appId}
              targetAppId={destination.appId}
            />
          )}
        </TabContainer>
      </div>
    </div>
  );
}
