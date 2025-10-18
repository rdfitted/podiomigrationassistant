/**
 * Podio migration utilities
 * Concrete operations for discovering, migrating, and validating Podio resources
 */

import { getOrganizations } from './resources/organizations';
import { getSpaces, getSpace, createSpace as createSpaceResource } from './resources/spaces';
import {
  getApplications,
  getApplication,
  createApplication,
  updateApplicationField,
} from './resources/applications';
import { getFlows, getFlow, createFlow } from './resources/flows';
import { getHooks, getHook, createHook, cloneHook as cloneHookResource } from './resources/hooks';
import { getPodioHttpClient } from './http/client';
import { PodioApiError } from './errors';
import type {
  Organization,
  Space,
  Application,
  AppField,
  Flow,
  Hook,
} from './types';

// ============================================================================
// Discovery Functions
// ============================================================================

/**
 * List all organizations accessible to the user
 */
export async function listOrganizations(): Promise<Organization[]> {
  return getOrganizations();
}

/**
 * List all spaces in an organization
 */
export async function listSpaces(organizationId: number): Promise<Space[]> {
  return getSpaces(organizationId);
}

/**
 * Get apps with flow and hook counts for a space
 */
export async function getSpaceAppsWithMetadata(spaceId: number) {
  const apps = await getApplications(spaceId);

  const appsWithMetadata = await Promise.all(
    apps.map(async (app) => {
      const [flows, hooks] = await Promise.all([
        getFlows(app.app_id).catch(() => []),
        getHooks(app.app_id).catch(() => []),
      ]);

      return {
        app_id: app.app_id,
        name: app.config.name,
        url_label: app.url_label,
        flows_count: flows.length,
        hooks_count: hooks.length,
      };
    })
  );

  return appsWithMetadata;
}

/**
 * Get detailed app structure including fields
 */
export async function getAppStructureDetailed(appId: number) {
  const app = await getApplication(appId);

  return {
    app_id: app.app_id,
    name: app.config.name,
    item_name: app.config.item_name,
    space_id: app.space_id,
    fields: app.fields?.map((field) => ({
      field_id: field.field_id,
      type: field.type,
      external_id: field.external_id,
      label: field.config.label,
      required: field.config.required,
      unique: field.config.unique,
      referenced_apps: field.config.settings?.referenced_apps || null,
    })),
    field_count: app.fields?.length || 0,
  };
}

/**
 * Get flows for an application
 */
export async function getAppFlowsList(appId: number) {
  const flows = await getFlows(appId);

  return flows.map((flow) => ({
    flow_id: flow.flow_id,
    name: flow.name,
    status: flow.status,
    type: flow.type,
  }));
}

/**
 * Get hooks for an application
 */
export async function getAppHooksList(appId: number) {
  const hooks = await getHooks(appId);

  return hooks.map((hook) => ({
    hook_id: hook.hook_id,
    type: hook.type,
    url: hook.url,
    status: hook.status,
  }));
}

// ============================================================================
// Migration Functions
// ============================================================================

/**
 * Create a new space in an organization
 */
export async function createNewSpace(
  organizationId: number,
  name: string,
  privacy: 'open' | 'closed' = 'closed'
) {
  const result = await createSpaceResource(organizationId, {
    name,
    privacy,
  });

  // Fetch the created space details
  const newSpace = await getSpace(result.space_id);

  return {
    space_id: newSpace.space_id,
    name: newSpace.name,
    url: newSpace.url,
    org_id: newSpace.org_id,
    privacy: newSpace.privacy,
  };
}

/**
 * Clone an app to a target space
 * Copies app configuration and fields
 */
export async function cloneAppToSpace(
  sourceAppId: number,
  targetSpaceId: number,
  newName?: string
) {
  // Get source app structure
  const sourceApp = await getApplication(sourceAppId);

  // Prepare new app configuration
  const newAppData = {
    config: {
      name: newName || `${sourceApp.config.name} (Copy)`,
      item_name: sourceApp.config.item_name,
      description: sourceApp.config.description,
      icon: sourceApp.config.icon,
      allow_edit: sourceApp.config.allow_edit,
      allow_create: sourceApp.config.allow_create,
    },
    fields: sourceApp.fields?.map((field) => ({
      type: field.type,
      config: {
        label: field.config.label || field.external_id || 'Untitled Field',
        description: field.config.description,
        required: field.config.required,
        unique: field.config.unique,
        settings: field.config.settings,
      },
    })),
  };

  // Create new app
  const result = await createApplication(targetSpaceId, newAppData);

  // Fetch the created app to get field mappings
  const newApp = await getApplication(result.app_id);

  // Create field mapping
  const fieldMapping =
    sourceApp.fields?.map((sourceField, index) => ({
      source_field_id: sourceField.field_id,
      target_field_id: newApp.fields?.[index]?.field_id || 0,
      label: sourceField.config.label || '',
    })) || [];

  return {
    app_id: result.app_id,
    name: newApp.config.name,
    space_id: targetSpaceId,
    field_mapping: fieldMapping,
    fields_cloned: fieldMapping.length,
  };
}

/**
 * Recursively remap field_id references in a config object
 */
function remapFieldReferences(
  obj: unknown,
  fieldMapping: Map<number, number>
): { remapped: unknown; count: number } {
  let count = 0;

  if (obj === null || obj === undefined) {
    return { remapped: obj, count: 0 };
  }

  // Handle arrays
  if (Array.isArray(obj)) {
    const remappedArray = obj.map((item) => {
      const result = remapFieldReferences(item, fieldMapping);
      count += result.count;
      return result.remapped;
    });
    return { remapped: remappedArray, count };
  }

  // Handle objects
  if (typeof obj === 'object') {
    const remappedObj: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(obj)) {
      // Check if this is a field_id key with a numeric value
      if (key === 'field_id' && typeof value === 'number') {
        const mappedId = fieldMapping.get(value);
        if (mappedId !== undefined) {
          remappedObj[key] = mappedId;
          count++;
        } else {
          remappedObj[key] = value;
        }
      }
      // Also check for field_ids (plural) array
      else if (key === 'field_ids' && Array.isArray(value)) {
        remappedObj[key] = value.map((id) => {
          if (typeof id === 'number') {
            const mappedId = fieldMapping.get(id);
            if (mappedId !== undefined) {
              count++;
              return mappedId;
            }
          }
          return id;
        });
      }
      // Recursively process nested objects/arrays
      else {
        const result = remapFieldReferences(value, fieldMapping);
        count += result.count;
        remappedObj[key] = result.remapped;
      }
    }

    return { remapped: remappedObj, count };
  }

  // Primitive values - return as-is
  return { remapped: obj, count: 0 };
}

/**
 * Clone a flow to a target app
 * Field references in trigger/actions/conditions are automatically remapped using the provided field mapping
 */
export async function cloneFlowToApp(
  sourceFlowId: string,
  targetAppId: number,
  fieldMapping?: Array<{ source_field_id: number; target_field_id: number }>
) {
  // Get source flow
  const sourceFlow = await getFlow(sourceFlowId);

  let referencesUpdated = 0;

  // Create field mapping lookup for efficient remapping
  const fieldMap = new Map<number, number>();
  if (fieldMapping && fieldMapping.length > 0) {
    fieldMapping.forEach((mapping) => {
      fieldMap.set(mapping.source_field_id, mapping.target_field_id);
    });
  }

  // Remap field references in trigger, actions, and conditions
  let remappedTrigger = sourceFlow.trigger;
  let remappedActions = sourceFlow.actions;
  let remappedConditions = sourceFlow.conditions;

  if (fieldMap.size > 0) {
    // Remap trigger field references
    if (sourceFlow.trigger) {
      const triggerResult = remapFieldReferences(sourceFlow.trigger, fieldMap);
      remappedTrigger = triggerResult.remapped as typeof sourceFlow.trigger;
      referencesUpdated += triggerResult.count;
    }

    // Remap actions field references
    if (sourceFlow.actions) {
      const actionsResult = remapFieldReferences(sourceFlow.actions, fieldMap);
      remappedActions = actionsResult.remapped as typeof sourceFlow.actions;
      referencesUpdated += actionsResult.count;
    }

    // Remap conditions field references
    if (sourceFlow.conditions) {
      const conditionsResult = remapFieldReferences(sourceFlow.conditions, fieldMap);
      remappedConditions = conditionsResult.remapped as typeof sourceFlow.conditions;
      referencesUpdated += conditionsResult.count;
    }
  }

  // Create flow with remapped field references
  const newFlowData = {
    name: `${sourceFlow.name} (Copy)`,
    status: 'inactive' as const, // Start inactive for safety
    type: sourceFlow.type,
    trigger: remappedTrigger,
    actions: remappedActions,
    conditions: remappedConditions,
  };

  // Create new flow
  const result = await createFlow(targetAppId, newFlowData);

  return {
    flow_id: result.flow_id,
    name: newFlowData.name,
    app_id: targetAppId,
    status: newFlowData.status,
    references_updated: referencesUpdated,
  };
}

/**
 * Clone a hook to a target app
 */
export async function cloneHookToApp(
  sourceHookId: number,
  targetAppId: number,
  urlOverride?: string
) {
  // Get source hook
  const sourceHook = await getHook(sourceHookId);

  // Create new hook
  const result = await cloneHookResource(sourceHookId, targetAppId, urlOverride);

  // Fetch created hook details
  const newHook = await getHook(result.hook_id);

  return {
    hook_id: newHook.hook_id,
    type: newHook.type,
    url: newHook.url,
    status: newHook.status,
    app_id: targetAppId,
  };
}

/**
 * Update app reference fields
 * Maps old app references to new app references
 */
export async function updateAppReferenceFields(
  appId: number,
  referenceMappings: Array<{
    field_id: number;
    old_app_ids: number[];
    new_app_ids: number[];
  }>
) {
  const app = await getApplication(appId);
  let updatedFields = 0;
  const unresolvedReferences: Array<{
    field_id: number;
    field_label: string;
    reason: string;
  }> = [];

  for (const mapping of referenceMappings) {
    const field = app.fields?.find((f) => f.field_id === mapping.field_id);

    if (!field) {
      unresolvedReferences.push({
        field_id: mapping.field_id,
        field_label: 'Unknown',
        reason: 'Field not found in app',
      });
      continue;
    }

    // Update the field's referenced apps
    try {
      const newSettings = {
        ...field.config.settings,
        referenced_apps: mapping.new_app_ids.map((app_id) => ({
          app_id,
          view_id: undefined,
        })),
      };

      await updateApplicationField(appId, mapping.field_id, {
        config: {
          settings: newSettings,
        },
      });

      updatedFields++;
    } catch (error) {
      unresolvedReferences.push({
        field_id: mapping.field_id,
        field_label: field.config.label || 'Unknown',
        reason: error instanceof Error ? error.message : 'Update failed',
      });
    }
  }

  return {
    updated_fields: updatedFields,
    unresolved_references: unresolvedReferences,
  };
}

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Validate that target app structure matches source app
 */
export async function validateAppStructures(
  sourceAppId: number,
  targetAppId: number,
  strictMode: boolean = false
) {
  const [sourceApp, targetApp] = await Promise.all([
    getApplication(sourceAppId),
    getApplication(targetAppId),
  ]);

  const differences: Array<{
    type: 'missing_field' | 'extra_field' | 'field_type_mismatch' | 'config_mismatch';
    field_label: string;
    severity: 'error' | 'warning' | 'info';
    details: string;
  }> = [];

  const sourceFields = sourceApp.fields || [];
  const targetFields = targetApp.fields || [];

  // Check for missing fields
  for (const sourceField of sourceFields) {
    const targetField = targetFields.find(
      (f) => f.external_id === sourceField.external_id || f.config.label === sourceField.config.label
    );

    if (!targetField) {
      differences.push({
        type: 'missing_field',
        field_label: sourceField.config.label || sourceField.external_id,
        severity: 'error',
        details: `Field "${sourceField.config.label}" exists in source but not in target`,
      });
    } else if (targetField.type !== sourceField.type) {
      differences.push({
        type: 'field_type_mismatch',
        field_label: sourceField.config.label || sourceField.external_id,
        severity: 'error',
        details: `Field type mismatch: source=${sourceField.type}, target=${targetField.type}`,
      });
    } else if (strictMode) {
      // Strict mode: check config differences
      if (targetField.config.required !== sourceField.config.required) {
        differences.push({
          type: 'config_mismatch',
          field_label: sourceField.config.label || sourceField.external_id,
          severity: 'warning',
          details: `Required setting differs: source=${sourceField.config.required}, target=${targetField.config.required}`,
        });
      }
    }
  }

  // Check for extra fields
  for (const targetField of targetFields) {
    const sourceField = sourceFields.find(
      (f) => f.external_id === targetField.external_id || f.config.label === targetField.config.label
    );

    if (!sourceField) {
      differences.push({
        type: 'extra_field',
        field_label: targetField.config.label || targetField.external_id,
        severity: 'info',
        details: `Field "${targetField.config.label}" exists in target but not in source`,
      });
    }
  }

  const hasErrors = differences.some((d) => d.severity === 'error');

  return {
    valid: !hasErrors,
    differences,
    source_field_count: sourceFields.length,
    target_field_count: targetFields.length,
  };
}

/**
 * Test a flow execution
 * Note: This is a placeholder - actual flow testing uses Podio Items API to trigger flows
 */
export async function testFlowExecution(flowId: string, testPayload?: Record<string, unknown>) {
  const { createTestItem } = await import('./resources/items');
  const client = getPodioHttpClient();

  // Get flow details
  const flow = await getFlow(flowId);

  const executionLogs: string[] = [
    `Flow ${flow.flow_id} retrieved successfully`,
    `Flow name: ${flow.name}`,
    `Flow status: ${flow.status}`,
  ];

  const errors: string[] = [];
  let testItemCreated = false;
  let testItemId: number | undefined;

  // Check if flow is active
  if (flow.status !== 'active') {
    errors.push('Flow is not active');
    return {
      flow_id: flowId,
      test_successful: false,
      execution_logs: executionLogs,
      errors,
      test_item_id: undefined,
    };
  }

  // Attempt to create a test item to trigger the flow
  try {
    const appId = flow.app_id;
    executionLogs.push(`Creating test item in app ${appId} to trigger flow`);

    const testItem = await createTestItem(client, appId, testPayload);
    testItemCreated = true;
    testItemId = testItem.item_id;

    executionLogs.push(`Test item created: ID ${testItem.item_id} (App Item ID: ${testItem.app_item_id})`);
    executionLogs.push('Flow should trigger automatically based on its configuration');
    executionLogs.push('Note: Flow execution verification requires polling or webhook integration');
  } catch (error) {
    errors.push(`Failed to create test item: ${error instanceof Error ? error.message : 'Unknown error'}`);
    executionLogs.push(`Test item creation failed - flow trigger could not be verified`);
  }

  // Note: Actual flow execution verification would require:
  // 1. Polling the flow execution logs (if Globiflow API provides this)
  // 2. Webhook listener to capture flow completion events
  // 3. Checking for expected side effects (e.g., new items created, fields updated)

  return {
    flow_id: flowId,
    test_successful: testItemCreated,
    execution_logs: executionLogs,
    errors,
    test_item_id: testItemId,
    note: 'Test item created successfully. Flow should execute automatically. Full execution verification requires Globiflow API integration or webhook monitoring.',
  };
}

/**
 * Get migration job status with state persistence
 */
export async function getMigrationJobStatus(migrationId: string) {
  const { migrationStateStore } = await import('../migration/state-store');

  try {
    // Initialize state store if needed
    await migrationStateStore.initialize();

    // Get migration job from state store
    const job = await migrationStateStore.getMigrationJob(migrationId);

    if (!job) {
      return {
        migration_id: migrationId,
        status: 'not_found' as const,
        message: `Migration job ${migrationId} not found`,
      };
    }

    // Calculate progress
    const totalSteps = job.steps.length;
    const completedSteps = job.steps.filter(s => s.status === 'completed').length;
    const failedSteps = job.steps.filter(s => s.status === 'failed').length;
    const inProgressSteps = job.steps.filter(s => s.status === 'in_progress').length;
    const percentage = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;

    // Summarize migration resources
    const appCount = job.steps.filter(s => s.type === 'clone_app').length;
    const flowCount = job.steps.filter(s => s.type === 'clone_flow').length;
    const hookCount = job.steps.filter(s => s.type === 'clone_hook').length;
    const referenceUpdates = job.steps.filter(s => s.type === 'update_references').length;

    return {
      migration_id: migrationId,
      status: job.status,
      started_at: job.startedAt.toISOString(),
      completed_at: job.completedAt?.toISOString(),
      source_space_id: job.sourceSpaceId,
      target_space_id: job.targetSpaceId,
      progress: {
        total_steps: totalSteps,
        completed_steps: completedSteps,
        failed_steps: failedSteps,
        in_progress_steps: inProgressSteps,
        percentage,
      },
      summary: {
        apps_cloned: appCount,
        flows_cloned: flowCount,
        hooks_cloned: hookCount,
        reference_updates: referenceUpdates,
      },
      errors: job.errors.map(err => ({
        step: err.step,
        message: err.message,
        code: err.code,
        timestamp: err.timestamp.toISOString(),
      })),
      metadata: job.metadata,
    };
  } catch (error) {
    return {
      migration_id: migrationId,
      status: 'error' as const,
      message: `Failed to retrieve migration status: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

// ============================================================================
// PHASE 5: Data Migration Functions
// ============================================================================

/**
 * Get item count for an app
 */
export async function getItemCountForApp(
  appId: number,
  filters?: Record<string, unknown>
) {
  const { fetchItemCount } = await import('./resources/items');
  const client = getPodioHttpClient();

  const result = await fetchItemCount(client, appId, filters);

  return {
    total: result.total,
    filtered: result.filtered,
    sampledAt: new Date().toISOString(),
  };
}

/**
 * Migrate items between apps
 */
export async function migrateItemsBetweenApps(config: {
  sourceAppId: number;
  targetAppId: number;
  fieldMapping: Record<string, string>;
  mode: 'create' | 'update' | 'upsert';
  sourceMatchField?: string;
  targetMatchField?: string;
  duplicateBehavior?: 'skip' | 'error' | 'update';
  batchSize?: number;
  concurrency?: number;
  stopOnError?: boolean;
  filters?: Record<string, unknown>;
  resumeToken?: string;
}) {
  const { itemMigrator } = await import('../migration/items/item-migrator');

  const result = await itemMigrator.executeMigration(config);

  return {
    migrationId: result.migrationId,
    processed: result.processed,
    successful: result.successful,
    failed: result.failed,
    failedItems: result.failedItems,
    durationMs: result.durationMs,
    throughput: result.throughput,
    completed: result.completed,
    resumeToken: result.migrationId, // Use migration ID as resume token
  };
}

/**
 * Export items from an app
 */
export async function exportAppItems(
  appId: number,
  outputPath?: string,
  options?: {
    filters?: Record<string, unknown>;
    format?: 'json' | 'ndjson';
    batchSize?: number;
  }
) {
  const { itemMigrator } = await import('../migration/items/item-migrator');

  const finalOutputPath = outputPath || `data/exports/app-${appId}.json`;

  const result = await itemMigrator.exportItems(appId, finalOutputPath, options);

  return {
    filePath: result.filePath,
    total: result.total,
  };
}

/**
 * Import items to an app
 */
export async function importItemsToApp(
  targetAppId: number,
  sourceFilePath: string,
  options?: {
    mode?: 'create' | 'update' | 'upsert';
    batchSize?: number;
    dryRun?: boolean;
  }
) {
  const { itemMigrator } = await import('../migration/items/item-migrator');

  const result = await itemMigrator.importItems(targetAppId, sourceFilePath, options);

  return {
    processed: result.processed,
    successful: result.successful,
    failed: result.failed,
    failedItems: result.failedItems,
    ...(options?.dryRun && {
      dryRunSummary: {
        wouldProcess: result.processed,
        estimatedDuration: `${Math.ceil(result.processed / 500)} minutes`,
      },
    }),
  };
}

/**
 * Validate item migration integrity
 */
export async function validateItemMigrationIntegrity(
  sourceAppId: number,
  targetAppId: number,
  fieldMapping: Record<string, string>,
  options?: {
    sampleSize?: number;
    strict?: boolean;
  }
) {
  const { itemMigrator } = await import('../migration/items/item-migrator');

  const result = await itemMigrator.validateMigration(
    sourceAppId,
    targetAppId,
    fieldMapping,
    options
  );

  return {
    total: result.total,
    matched: result.matched,
    mismatched: result.mismatched,
    missingInTarget: result.missingInTarget,
    missingInSource: result.missingInSource,
  };
}
