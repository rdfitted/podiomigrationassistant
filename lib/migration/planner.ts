/**
 * Migration planning service
 * Generates comprehensive migration plans with dependency analysis and conflict detection
 */

import { v4 as uuidv4 } from 'uuid';
import {
  MigrationPlan,
  MigrationScope,
  MigrationEntity,
  MigrationConflict,
  FieldMapping,
} from '../ai/schemas/migration';
import { getOrganization } from '../podio/resources/organizations';
import { getSpaces } from '../podio/resources/spaces';
import { getApplications, getApplication } from '../podio/resources/applications';
import { getFlows } from '../podio/resources/flows';
import { getHooks } from '../podio/resources/hooks';

/**
 * Generate a comprehensive migration plan
 */
export async function generateMigrationPlan(
  sourceWorkspaceId: number,
  targetWorkspaceId: number,
  scope?: MigrationScope
): Promise<MigrationPlan> {
  const planId = uuidv4();
  const entities: MigrationEntity[] = [];
  const conflicts: MigrationConflict[] = [];
  const fieldMappings: FieldMapping[] = [];

  // Default scope
  const migrationScope: MigrationScope = {
    includeOrganizations: scope?.includeOrganizations ?? false,
    includeSpaces: scope?.includeSpaces ?? true,
    includeApplications: scope?.includeApplications ?? true,
    includeFlows: scope?.includeFlows ?? true,
    includeHooks: scope?.includeHooks ?? true,
    specificSpaceIds: scope?.specificSpaceIds,
    specificAppIds: scope?.specificAppIds,
  };

  // Collect organizations metadata if requested
  if (migrationScope.includeOrganizations) {
    const sourceOrg = await getOrganization(sourceWorkspaceId);
    entities.push({
      entityType: 'organization',
      sourceId: sourceOrg.org_id,
      sourceName: sourceOrg.name,
      status: 'pending',
      dependencies: [],
      conflicts: [],
    });
  }

  // Collect spaces
  if (migrationScope.includeSpaces) {
    const spaces = await getSpaces(sourceWorkspaceId);
    const filteredSpaces = migrationScope.specificSpaceIds
      ? spaces.filter((s) => migrationScope.specificSpaceIds!.includes(s.space_id))
      : spaces;

    for (const space of filteredSpaces) {
      entities.push({
        entityType: 'space',
        sourceId: space.space_id,
        sourceName: space.name,
        status: 'pending',
        dependencies: [sourceWorkspaceId],
        conflicts: [],
      });

      // Collect applications in space
      if (migrationScope.includeApplications) {
        const apps = await getApplications(space.space_id);
        const filteredApps = migrationScope.specificAppIds
          ? apps.filter((a) => migrationScope.specificAppIds!.includes(a.app_id))
          : apps;

        for (const app of filteredApps) {
          const appDetails = await getApplication(app.app_id);
          const dependencies: (number | string)[] = [space.space_id];

          // Check for app reference fields
          const appReferenceFields =
            appDetails.fields?.filter(
              (f) => f.type === 'app' && f.config.referenced_apps?.length
            ) || [];

          if (appReferenceFields.length > 0) {
            appReferenceFields.forEach((field) => {
              field.config.referenced_apps?.forEach((refApp) => {
                dependencies.push(refApp.app_id);
              });
            });

            conflicts.push({
              type: 'app_reference_broken',
              severity: 'warning',
              entityType: 'application',
              entityId: app.app_id,
              entityName: app.config.name,
              message: `Application has ${appReferenceFields.length} app reference field(s) that need remapping`,
              suggestedResolution:
                'Ensure referenced applications are migrated first and update field mappings',
              canAutoresolve: false,
            });
          }

          entities.push({
            entityType: 'application',
            sourceId: app.app_id,
            sourceName: app.config.name,
            status: 'pending',
            dependencies,
            conflicts: [],
            metadata: {
              fieldCount: appDetails.fields?.length || 0,
              hasAppReferences: appReferenceFields.length > 0,
            },
          });

          // Collect flows for application
          if (migrationScope.includeFlows) {
            try {
              const flows = await getFlows(app.app_id);

              for (const flow of flows) {
                entities.push({
                  entityType: 'flow',
                  sourceId: flow.flow_id,
                  sourceName: flow.name,
                  status: 'pending',
                  dependencies: [app.app_id],
                  conflicts: [],
                  metadata: {
                    flowStatus: flow.status,
                    flowType: flow.type,
                  },
                });
              }
            } catch (error) {
              // Flows might not be available for all apps
              console.warn(`Could not fetch flows for app ${app.app_id}:`, error);
            }
          }

          // Collect hooks for application
          if (migrationScope.includeHooks) {
            try {
              const hooks = await getHooks(app.app_id);

              for (const hook of hooks) {
                entities.push({
                  entityType: 'hook',
                  sourceId: hook.hook_id,
                  sourceName: `${hook.type} -> ${hook.url}`,
                  status: 'pending',
                  dependencies: [app.app_id],
                  conflicts: [],
                  metadata: {
                    hookUrl: hook.url,
                    hookType: hook.type,
                  },
                });

                conflicts.push({
                  type: 'hook_validation_failed',
                  severity: 'info',
                  entityType: 'hook',
                  entityId: hook.hook_id,
                  entityName: `${hook.type} -> ${hook.url}`,
                  message: 'Hook will require re-verification after migration',
                  suggestedResolution: 'Verify webhook after migration completes',
                  canAutoresolve: false,
                });
              }
            } catch (error) {
              console.warn(`Could not fetch hooks for app ${app.app_id}:`, error);
            }
          }
        }
      }
    }
  }

  // Build execution order based on dependencies
  const executionOrder = buildExecutionOrder(entities);

  // Create migration plan
  const plan: MigrationPlan = {
    planId,
    sourceWorkspaceId,
    targetWorkspaceId,
    scope: migrationScope,
    entities,
    fieldMappings,
    executionOrder,
    conflicts,
    estimatedDuration: estimateDuration(entities),
    createdAt: new Date().toISOString(),
    status: conflicts.some((c) => c.severity === 'error') ? 'draft' : 'ready',
  };

  return plan;
}

/**
 * Build execution order using topological sort
 */
function buildExecutionOrder(entities: MigrationEntity[]): (number | string)[] {
  const order: (number | string)[] = [];
  const visited = new Set<number | string>();
  const visiting = new Set<number | string>();

  function visit(entityId: number | string) {
    if (visited.has(entityId)) return;
    if (visiting.has(entityId)) {
      // Circular dependency - just add it
      return;
    }

    visiting.add(entityId);

    const entity = entities.find((e) => e.sourceId === entityId);
    if (entity) {
      entity.dependencies.forEach((dep) => visit(dep));
    }

    visiting.delete(entityId);
    visited.add(entityId);
    order.push(entityId);
  }

  entities.forEach((entity) => visit(entity.sourceId));

  return order;
}

/**
 * Estimate migration duration
 */
function estimateDuration(entities: MigrationEntity[]): string {
  const counts = {
    organization: 0,
    space: 0,
    application: 0,
    flow: 0,
    hook: 0,
  };

  entities.forEach((e) => {
    counts[e.entityType]++;
  });

  // Rough estimates in seconds
  const duration =
    counts.organization * 5 +
    counts.space * 10 +
    counts.application * 30 +
    counts.flow * 15 +
    counts.hook * 10;

  if (duration < 60) return `${duration} seconds`;
  if (duration < 3600) return `${Math.ceil(duration / 60)} minutes`;
  return `${Math.ceil(duration / 3600)} hours`;
}

/**
 * Validate migration plan dependencies
 */
export async function validatePlanDependencies(plan: MigrationPlan): Promise<{
  valid: boolean;
  errors: string[];
  warnings: string[];
}> {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check for unresolved dependencies
  const entityIds = new Set(plan.entities.map((e) => e.sourceId));

  plan.entities.forEach((entity) => {
    entity.dependencies.forEach((dep) => {
      if (!entityIds.has(dep)) {
        warnings.push(
          `Entity ${entity.sourceName} (${entity.sourceId}) depends on ${dep} which is not in the migration plan`
        );
      }
    });
  });

  // Check for circular dependencies
  const hasCycle = detectCycle(plan.entities);
  if (hasCycle) {
    errors.push('Migration plan contains circular dependencies');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Detect cycles in dependency graph
 */
function detectCycle(entities: MigrationEntity[]): boolean {
  const visited = new Set<number | string>();
  const recStack = new Set<number | string>();

  function hasCycleUtil(entityId: number | string): boolean {
    visited.add(entityId);
    recStack.add(entityId);

    const entity = entities.find((e) => e.sourceId === entityId);
    if (entity) {
      for (const dep of entity.dependencies) {
        if (!visited.has(dep)) {
          if (hasCycleUtil(dep)) return true;
        } else if (recStack.has(dep)) {
          return true;
        }
      }
    }

    recStack.delete(entityId);
    return false;
  }

  for (const entity of entities) {
    if (!visited.has(entity.sourceId)) {
      if (hasCycleUtil(entity.sourceId)) return true;
    }
  }

  return false;
}

/**
 * Summarize migration plan for agent display
 */
export function summarizePlanForAgent(plan: MigrationPlan): string {
  const counts = {
    organization: 0,
    space: 0,
    application: 0,
    flow: 0,
    hook: 0,
  };

  plan.entities.forEach((e) => {
    counts[e.entityType]++;
  });

  const parts: string[] = [];
  if (counts.organization > 0) parts.push(`${counts.organization} organization(s)`);
  if (counts.space > 0) parts.push(`${counts.space} space(s)`);
  if (counts.application > 0) parts.push(`${counts.application} application(s)`);
  if (counts.flow > 0) parts.push(`${counts.flow} flow(s)`);
  if (counts.hook > 0) parts.push(`${counts.hook} hook(s)`);

  const summary = `Migration plan includes: ${parts.join(', ')}.`;
  const conflictSummary =
    plan.conflicts.length > 0
      ? ` Found ${plan.conflicts.length} conflict(s) requiring attention.`
      : ' No conflicts detected.';

  return summary + conflictSummary + ` Estimated duration: ${plan.estimatedDuration}.`;
}
