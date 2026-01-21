/**
 * AI Tool definitions for Podio operations
 * Provides tool calling interface for AI agent to interact with Podio
 *
 * Phase 3: Comprehensive Podio tool integration with migration support
 */

import { tool } from 'ai';
import * as schemas from './schemas';
import * as migration from '../podio/migration';
import { PodioApiError } from '../podio/errors';
import { getAppStructureCache } from '../migration/items/app-structure-cache';
import { buildPodioItemFilters } from '../migration/items/filter-converter';
import { z } from 'zod';

// ============================================================================
// Error Handling Helper
// ============================================================================

function handleToolError(error: unknown, operation: string) {
  if (error instanceof PodioApiError) {
    return {
      success: false,
      error: {
        message: `Failed to ${operation}: ${error.toHumanReadable()}`,
        status: error.statusCode,
        code: error.errorCode,
        detail: error.errorDetail,
      },
    };
  }

  return {
    success: false,
    error: {
      message: `Failed to ${operation}: ${error instanceof Error ? error.message : String(error)}`,
    },
  };
}

/**
 * Build Podio API-compatible item filters for the Phase 5 tools.
 * Accepts either Podio-native filter keys (passed through) and/or user-friendly date keys
 * (`createdFrom`, `createdTo`, `lastEditFrom`, `lastEditTo`) which are converted.
 */
function buildItemFiltersForTool(input: {
  filters?: Record<string, unknown>;
  createdFrom?: string;
  createdTo?: string;
  lastEditFrom?: string;
  lastEditTo?: string;
}): Record<string, unknown> | undefined {
  const podioFilters = buildPodioItemFilters(input.filters, {
    createdFrom: input.createdFrom,
    createdTo: input.createdTo,
    lastEditFrom: input.lastEditFrom,
    lastEditTo: input.lastEditTo,
  });

  return Object.keys(podioFilters).length > 0 ? podioFilters : undefined;
}

// ============================================================================
// Discovery Tools
// ============================================================================

/**
 * List all organizations accessible to the user
 */
export const listOrganizations = tool({
  description: 'List all Podio organizations (workspaces) that the user has access to. Returns org ID, name, URL, role, and member count.',
  inputSchema: schemas.listOrganizationsInputSchema,
  execute: async () => {
    try {
      const orgs = await migration.listOrganizations();
      return {
        success: true,
        data: orgs.map((org) => ({
          org_id: org.org_id,
          name: org.name,
          url: org.url,
          role: org.role,
          member_count: org.member_count,
        })),
      };
    } catch (error) {
      return handleToolError(error, 'list organizations');
    }
  },
});

/**
 * List all spaces in an organization
 */
export const listSpaces = tool({
  description: 'List all spaces within a specific Podio organization. Spaces are collections of apps within an organization. Returns space ID, name, URL, privacy setting, and user role.',
  inputSchema: schemas.listSpacesInputSchema,
  execute: async ({ organizationId }) => {
    try {
      const spaces = await migration.listSpaces(organizationId);
      return {
        success: true,
        data: spaces.map((space) => ({
          space_id: space.space_id,
          name: space.name,
          url: space.url,
          org_id: space.org_id,
          privacy: space.privacy,
          role: space.role,
        })),
      };
    } catch (error) {
      return handleToolError(error, `list spaces for org ${organizationId}`);
    }
  },
});

/**
 * Get apps in a space with flow and hook counts
 */
export const getSpaceApps = tool({
  description: 'Get all applications within a specific space, including metadata about flows and hooks. Returns app ID, name, URL label, and counts of associated flows and webhooks.',
  inputSchema: schemas.getSpaceAppsInputSchema,
  execute: async ({ spaceId }) => {
    try {
      const apps = await migration.getSpaceAppsWithMetadata(spaceId);
      return {
        success: true,
        data: apps,
      };
    } catch (error) {
      return handleToolError(error, `get apps for space ${spaceId}`);
    }
  },
});

/**
 * Get detailed app structure including all fields
 */
export const getAppStructure = tool({
  description: 'Get detailed structure of a Podio application including all fields, their types, configurations, and app references. Essential for planning app cloning and migrations.',
  inputSchema: schemas.getAppStructureInputSchema,
  execute: async ({ appId }) => {
    try {
      const structure = await migration.getAppStructureDetailed(appId);
      return {
        success: true,
        data: structure,
      };
    } catch (error) {
      return handleToolError(error, `get app structure for app ${appId}`);
    }
  },
});

/**
 * Get all flows for an application
 */
export const getAppFlows = tool({
  description: 'Get all Globiflow workflows (flows) associated with a specific application. Returns flow ID, name, status (active/inactive), and type.',
  inputSchema: schemas.getAppFlowsInputSchema,
  execute: async ({ appId }) => {
    try {
      const flows = await migration.getAppFlowsList(appId);
      return {
        success: true,
        data: flows,
      };
    } catch (error) {
      return handleToolError(error, `get flows for app ${appId}`);
    }
  },
});

/**
 * Get all hooks for an application
 */
export const getAppHooks = tool({
  description: 'Get all webhooks configured for a specific application. Returns hook ID, type, URL, and status (active/inactive).',
  inputSchema: schemas.getAppHooksInputSchema,
  execute: async ({ appId }) => {
    try {
      const hooks = await migration.getAppHooksList(appId);
      return {
        success: true,
        data: hooks,
      };
    } catch (error) {
      return handleToolError(error, `get hooks for app ${appId}`);
    }
  },
});

// ============================================================================
// Migration Tools
// ============================================================================

/**
 * Create a new space in an organization
 */
export const createSpace = tool({
  description: 'Create a new space within a Podio organization. Use this as the first step when setting up a target workspace for migration. Returns the created space details.',
  inputSchema: schemas.createSpaceInputSchema,
  execute: async ({ organizationId, name, privacy }) => {
    try {
      const newSpace = await migration.createNewSpace(organizationId, name, privacy);
      return {
        success: true,
        data: newSpace,
      };
    } catch (error) {
      return handleToolError(error, `create space "${name}" in org ${organizationId}`);
    }
  },
});

/**
 * Clone an app to a target space
 */
export const cloneApp = tool({
  description: 'Clone a Podio application from source to target space. Copies app configuration and all fields. Returns new app ID and field mapping for reference updates. Note: App references and flows must be updated separately.',
  inputSchema: schemas.cloneAppInputSchema,
  execute: async ({ sourceAppId, targetSpaceId, newName }) => {
    try {
      const result = await migration.cloneAppToSpace(sourceAppId, targetSpaceId, newName);
      return {
        success: true,
        data: result,
      };
    } catch (error) {
      return handleToolError(error, `clone app ${sourceAppId} to space ${targetSpaceId}`);
    }
  },
});

/**
 * Clone a flow to a target app
 */
export const cloneFlow = tool({
  description: 'Clone a Globiflow workflow to a target application. Creates a copy of the flow configuration. Use fieldMapping to update field references after cloning apps. The cloned flow starts as inactive for safety.',
  inputSchema: schemas.cloneFlowInputSchema,
  execute: async ({ sourceFlowId, targetAppId, fieldMapping }) => {
    try {
      const result = await migration.cloneFlowToApp(sourceFlowId, targetAppId, fieldMapping);
      return {
        success: true,
        data: result,
      };
    } catch (error) {
      return handleToolError(error, `clone flow ${sourceFlowId} to app ${targetAppId}`);
    }
  },
});

/**
 * Clone a hook to a target app
 */
export const cloneHook = tool({
  description: 'Clone a webhook to a target application. Creates a new webhook with the same configuration. Optionally override the webhook URL. Note: The new webhook will require verification.',
  inputSchema: schemas.cloneHookInputSchema,
  execute: async ({ sourceHookId, targetAppId, urlOverride }) => {
    try {
      const result = await migration.cloneHookToApp(sourceHookId, targetAppId, urlOverride);
      return {
        success: true,
        data: result,
      };
    } catch (error) {
      return handleToolError(error, `clone hook ${sourceHookId} to app ${targetAppId}`);
    }
  },
});

/**
 * Update app reference fields after cloning
 */
export const updateAppReferences = tool({
  description: 'Update cross-app reference fields after cloning apps. Maps old app references to new app references. Use this after cloning multiple related apps to restore relationships. Returns count of updated fields and any unresolved references.',
  inputSchema: schemas.updateAppReferencesInputSchema,
  execute: async ({ appId, referenceMappings }) => {
    try {
      const result = await migration.updateAppReferenceFields(appId, referenceMappings);
      return {
        success: true,
        data: result,
      };
    } catch (error) {
      return handleToolError(error, `update app references for app ${appId}`);
    }
  },
});

// ============================================================================
// Validation Tools
// ============================================================================

/**
 * Validate app structure matches between source and target
 */
export const validateAppStructure = tool({
  description: 'Compare source and target app structures to verify migration success. Checks for missing fields, extra fields, type mismatches, and configuration differences. Use strictMode for detailed validation including required/unique settings.',
  inputSchema: schemas.validateAppStructureInputSchema,
  execute: async ({ sourceAppId, targetAppId, strictMode }) => {
    try {
      const result = await migration.validateAppStructures(sourceAppId, targetAppId, strictMode);
      return {
        success: true,
        data: result,
      };
    } catch (error) {
      return handleToolError(error, `validate app structure between ${sourceAppId} and ${targetAppId}`);
    }
  },
});

/**
 * Test a flow execution by creating a test item
 */
export const testFlow = tool({
  description: 'Test a flow by creating a test item in the associated app to trigger flow execution. Verifies flow is active and creates a test item. Returns test results including item ID. Note: Full flow execution verification requires Globiflow API or webhook monitoring.',
  inputSchema: schemas.testFlowInputSchema,
  execute: async ({ flowId, testPayload }) => {
    try {
      const result = await migration.testFlowExecution(flowId, testPayload);
      return {
        success: true,
        data: result,
      };
    } catch (error) {
      return handleToolError(error, `test flow ${flowId}`);
    }
  },
});

/**
 * Get migration job status with full state persistence
 */
export const getMigrationStatus = tool({
  description: 'Get the status and progress of a migration job tracked in the state store. Returns current status (planning/in_progress/completed/failed), detailed progress metrics, step-by-step breakdown, and summary of migrated resources (apps, flows, hooks). Includes error details if any steps failed.',
  inputSchema: schemas.getMigrationStatusInputSchema,
  execute: async ({ migrationId }) => {
    try {
      const result = await migration.getMigrationJobStatus(migrationId);
      return {
        success: true,
        data: result,
      };
    } catch (error) {
      return handleToolError(error, `get migration status for ${migrationId}`);
    }
  },
});

// ============================================================================
// PHASE 5: Data Migration Tools
// ============================================================================

/**
 * Get item count for an app
 */
export const getItemCount = tool({
  description: 'Get the total number of items in a Podio app. Essential for planning large-scale data migrations. Returns total item count and filtered count (if filters applied). Use this before migrating 80,000+ items to estimate duration. Supports date filtering (createdFrom, createdTo, lastEditFrom, lastEditTo).',
  inputSchema: schemas.getItemCountInputSchema,
  execute: async ({ appId, filters, createdFrom, createdTo, lastEditFrom, lastEditTo }) => {
    try {
      const combinedFilters = buildItemFiltersForTool({
        filters,
        createdFrom,
        createdTo,
        lastEditFrom,
        lastEditTo,
      });

      const result = await migration.getItemCountForApp(appId, combinedFilters);
      return {
        success: true,
        ...result,
      };
    } catch (error) {
      return handleToolError(error, `get item count for app ${appId}`);
    }
  },
});

/**
 * Migrate items between apps
 */
export const migrateItems = tool({
  description: 'Migrate items from source app to target app with field mapping. Supports duplicate detection, field-based updates, and date filtering (createdFrom, createdTo, lastEditFrom, lastEditTo). Modes: create (with optional duplicate check), update (requires both match fields), upsert (update if exists, create if not). Optimized for large-scale migrations (80,000+ items) with batch processing, automatic retry, progress tracking, and checkpoint/resume capability. Returns migration ID, progress stats (processed/successful/failed), throughput (items/sec), and resume token for interrupted migrations.',
  inputSchema: schemas.migrateItemsInputSchema,
  execute: async ({
    sourceAppId,
    targetAppId,
    fieldMapping,
    mode,
    sourceMatchField,
    targetMatchField,
    duplicateBehavior,
    batchSize,
    concurrency,
    stopOnError,
    filters,
    createdFrom,
    createdTo,
    lastEditFrom,
    lastEditTo,
    resumeToken,
  }) => {
    try {
      const combinedFilters = buildItemFiltersForTool({
        filters,
        createdFrom,
        createdTo,
        lastEditFrom,
        lastEditTo,
      });

      const result = await migration.migrateItemsBetweenApps({
        sourceAppId,
        targetAppId,
        fieldMapping,
        mode,
        sourceMatchField,
        targetMatchField,
        duplicateBehavior,
        batchSize,
        concurrency,
        stopOnError,
        filters: combinedFilters,
        resumeToken,
      });
      return {
        success: true,
        ...result,
      };
    } catch (error) {
      return handleToolError(error, `migrate items from app ${sourceAppId} to ${targetAppId}`);
    }
  },
});

/**
 * Export items to JSON file
 */
export const exportItems = tool({
  description: 'Export items from a Podio app to a JSON file. Supports streaming, ndjson format, and date filtering (createdFrom, createdTo, lastEditFrom, lastEditTo). Returns file path and total items exported. Use ndjson for 80,000+ items.',
  inputSchema: schemas.exportItemsInputSchema,
  execute: async ({ appId, outputPath, filters, createdFrom, createdTo, lastEditFrom, lastEditTo, format, batchSize }) => {
    try {
      const combinedFilters = buildItemFiltersForTool({
        filters,
        createdFrom,
        createdTo,
        lastEditFrom,
        lastEditTo,
      });

      const result = await migration.exportAppItems(
        appId,
        outputPath,
        {
          filters: combinedFilters,
          format,
          batchSize,
        }
      );
      return {
        success: true,
        ...result,
      };
    } catch (error) {
      return handleToolError(error, `export items from app ${appId}`);
    }
  },
});

/**
 * Import items from JSON file
 */
export const importItems = tool({
  description: 'Import items from a JSON file into a Podio app. Supports batch processing and dry-run mode for validation. Returns processed count, success/failure stats, and detailed error information for failed items. Use dryRun mode to validate before importing 80,000+ items.',
  inputSchema: schemas.importItemsInputSchema,
  execute: async ({ targetAppId, sourceFilePath, mode, batchSize, dryRun }) => {
    try {
      const result = await migration.importItemsToApp(
        targetAppId,
        sourceFilePath,
        {
          mode,
          batchSize,
          dryRun,
        }
      );
      return {
        success: true,
        ...result,
      };
    } catch (error) {
      return handleToolError(error, `import items to app ${targetAppId} from ${sourceFilePath}`);
    }
  },
});

/**
 * Validate item migration integrity
 */
export const validateItemMigration = tool({
  description: 'Validate data integrity after migration by comparing source and target items. Samples items from both apps, compares field values using the provided field mapping, and identifies mismatches or missing items. Returns matched/mismatched counts and detailed difference reports. Use after migrating 80,000+ items to verify data accuracy.',
  inputSchema: schemas.validateItemMigrationInputSchema,
  execute: async ({
    sourceAppId,
    targetAppId,
    fieldMapping,
    sampleSize,
    strict,
  }) => {
    try {
      const result = await migration.validateItemMigrationIntegrity(
        sourceAppId,
        targetAppId,
        fieldMapping,
        {
          sampleSize,
          strict,
        }
      );
      return {
        success: true,
        ...result,
      };
    } catch (error) {
      return handleToolError(error, `validate item migration between ${sourceAppId} and ${targetAppId}`);
    }
  },
});

// ============================================================================
// Cache Management Tools
// ============================================================================

/**
 * Clear app cache for specific app or all caches
 */
export const clearAppCache = tool({
  description: 'Clear cached app structure and field definitions for a specific Podio app, or clear all caches. Use this when fields have been deleted or modified in Podio and the cache is stale, causing migration or item creation failures. Optionally clear all caches by omitting appId.',
  inputSchema: z.object({
    appId: z.number().optional().describe('App ID to clear cache for. Omit to clear all caches.'),
  }),
  execute: async ({ appId }) => {
    try {
      const appStructureCache = getAppStructureCache();

      if (appId) {
        // Clear specific app cache
        appStructureCache.clearAppStructure(appId);
        return {
          success: true,
          data: { clearedApp: appId },
        };
      } else {
        // Clear all caches
        appStructureCache.clearAll();
        return {
          success: true,
          data: { clearedAll: true },
        };
      }
    } catch (error) {
      return handleToolError(error, 'clear app cache');
    }
  },
});

/**
 * Get cache status and statistics
 */
export const getCacheStatus = tool({
  description: 'Get current cache statistics including size, hit rate, age, and cached app IDs. Useful for debugging migration issues related to stale cache or understanding cache performance.',
  inputSchema: z.object({}),
  execute: async () => {
    try {
      const appStructureCache = getAppStructureCache();
      return {
        success: true,
        data: {
          appStructureCache: appStructureCache.getCacheStats(),
        },
      };
    } catch (error) {
      return handleToolError(error, 'get cache status');
    }
  },
});

// ============================================================================
// Export All Tools
// ============================================================================

/**
 * All Podio tools bundled for AI SDK integration
 * Phase 3: Extended with comprehensive resource-specific tools
 * Phase 5: Added large-scale data migration tools
 */
export const podioTools = {
  // Discovery tools
  listOrganizations,
  listSpaces,
  getSpaceApps,
  getAppStructure,
  getAppFlows,
  getAppHooks,

  // Migration tools (structure)
  createSpace,
  cloneApp,
  cloneFlow,
  cloneHook,
  updateAppReferences,

  // Data migration tools (Phase 5)
  getItemCount,
  migrateItems,
  exportItems,
  importItems,
  validateItemMigration,

  // Cache management tools
  clearAppCache,
  getCacheStatus,

  // Validation tools
  validateAppStructure,
  testFlow,
  getMigrationStatus,
};

/**
 * Type-safe tool map for reference
 */
export type PodioToolMap = typeof podioTools;

/**
 * Tool names as a const array
 */
export const podioToolNames = Object.keys(podioTools) as Array<keyof PodioToolMap>;
