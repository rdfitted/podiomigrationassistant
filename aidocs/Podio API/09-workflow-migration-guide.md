# Globiflow Workflow Migration Guide

## Overview
This guide provides a comprehensive approach to copying Globiflow workflows (Flows and Hooks) from one Podio workspace to another. Since Globiflow is built on top of Podio's native Flows API and external webhooks, the migration process involves cloning applications, mapping fields, and recreating automation.

## Prerequisites

- Admin access to both source and target organizations/workspaces
- Podio API credentials (client_id and client_secret)
- Authentication tokens for API access
- Understanding of source workspace structure

## Migration Strategy Overview

```
Phase 1: Discovery & Planning
  └── Map source workspace structure

Phase 2: Structure Migration
  ├── Clone spaces (or identify target space)
  ├── Clone applications
  └── Create field mappings

Phase 3: Workflow Migration
  ├── Migrate Flows (native automation)
  ├── Migrate Hooks (webhooks)
  └── Verify and test

Phase 4: Data Migration (Optional)
  └── Copy items if needed

Phase 5: Validation
  └── Test all workflows
```

## Phase 1: Discovery & Planning

### 1.1 Identify Source Structure

```javascript
async function discoverWorkspace(orgId, spaceId) {
  // Get organization details
  const org = await api.get(`/org/${orgId}`);

  // Get space details
  const space = await api.get(`/space/${spaceId}`);

  // Get all apps in space
  const apps = await api.get(`/app/space/${spaceId}/`);

  // For each app, get structure and automation
  const appDetails = [];

  for (const app of apps) {
    const appDetail = await api.get(`/app/${app.app_id}`);
    const flows = await api.get(`/flow/app/${app.app_id}/`);
    const hooks = await api.get(`/hook/app/${app.app_id}/`);

    appDetails.push({
      app: appDetail,
      flows,
      hooks
    });
  }

  return {
    org,
    space,
    apps: appDetails
  };
}
```

### 1.2 Analyze Dependencies

```javascript
function analyzeAppDependencies(appDetails) {
  const dependencies = new Map();

  appDetails.forEach(detail => {
    const appId = detail.app.app_id;
    const referencedApps = [];

    // Find app reference fields
    detail.app.fields.forEach(field => {
      if (field.type === 'app' && field.config.settings.referenced_apps) {
        field.config.settings.referenced_apps.forEach(ref => {
          referencedApps.push(ref.app_id);
        });
      }
    });

    dependencies.set(appId, referencedApps);
  });

  return dependencies;
}

function getAppMigrationOrder(dependencies) {
  // Topological sort to determine migration order
  const sorted = [];
  const visited = new Set();

  function visit(appId) {
    if (visited.has(appId)) return;

    visited.add(appId);

    const deps = dependencies.get(appId) || [];
    deps.forEach(depId => visit(depId));

    sorted.push(appId);
  }

  dependencies.forEach((_, appId) => visit(appId));

  return sorted;
}
```

### 1.3 Create Migration Plan

```javascript
class MigrationPlan {
  constructor(sourceOrgId, sourceSpaceId, targetOrgId, targetSpaceId) {
    this.source = { orgId: sourceOrgId, spaceId: sourceSpaceId };
    this.target = { orgId: targetOrgId, spaceId: targetSpaceId };
    this.appMappings = new Map(); // source app_id -> target app_id
    this.fieldMappings = new Map(); // source field_id -> target field_id
    this.itemMappings = new Map(); // source item_id -> target item_id
  }

  addAppMapping(sourceAppId, targetAppId) {
    this.appMappings.set(sourceAppId, targetAppId);
  }

  addFieldMapping(sourceAppId, sourceFieldId, targetFieldId) {
    const key = `${sourceAppId}:${sourceFieldId}`;
    this.fieldMappings.set(key, targetFieldId);
  }

  getTargetAppId(sourceAppId) {
    return this.appMappings.get(sourceAppId);
  }

  getTargetFieldId(sourceAppId, sourceFieldId) {
    const key = `${sourceAppId}:${sourceFieldId}`;
    return this.fieldMappings.get(key);
  }
}
```

## Phase 2: Structure Migration

### 2.1 Create or Identify Target Space

```javascript
async function ensureTargetSpace(api, targetOrgId, spaceName) {
  // Check if space exists
  const spaces = await api.get(`/space/org/${targetOrgId}/`);
  const existing = spaces.find(s => s.name === spaceName);

  if (existing) {
    console.log(`Using existing space: ${existing.name}`);
    return existing;
  }

  // Create new space
  const newSpace = await api.post('/space/', {
    org_id: targetOrgId,
    name: spaceName,
    privacy: 'closed',
    auto_join: false
  });

  console.log(`Created new space: ${newSpace.name}`);
  return newSpace;
}
```

### 2.2 Clone Applications

```javascript
async function cloneApp(api, sourceAppId, targetSpaceId, migrationPlan) {
  // Get source app structure
  const sourceApp = await api.get(`/app/${sourceAppId}`);

  // Prepare app configuration
  const appConfig = {
    config: {
      ...sourceApp.config,
      name: sourceApp.config.name // Keep same name or add suffix
    },
    fields: sourceApp.fields.map(field => ({
      type: field.type,
      external_id: field.external_id,
      config: { ...field.config }
    }))
  };

  // Create target app
  const targetApp = await api.post(`/app/space/${targetSpaceId}/`, appConfig);

  // Store app mapping
  migrationPlan.addAppMapping(sourceApp.app_id, targetApp.app_id);

  // Store field mappings
  sourceApp.fields.forEach((sourceField, index) => {
    const targetField = targetApp.fields[index];
    migrationPlan.addFieldMapping(
      sourceApp.app_id,
      sourceField.field_id,
      targetField.field_id
    );
  });

  console.log(`Cloned app: ${sourceApp.config.name} (${sourceApp.app_id} -> ${targetApp.app_id})`);

  return targetApp;
}
```

### 2.3 Fix App Reference Fields

```javascript
async function fixAppReferences(api, targetAppId, migrationPlan) {
  const app = await api.get(`/app/${targetAppId}`);

  for (const field of app.fields) {
    if (field.type === 'app' && field.config.settings.referenced_apps) {
      const updatedRefs = field.config.settings.referenced_apps.map(ref => {
        const newAppId = migrationPlan.getTargetAppId(ref.app_id);
        return { app_id: newAppId || ref.app_id };
      });

      await api.put(`/app/${targetAppId}/field/${field.field_id}`, {
        config: {
          settings: {
            referenced_apps: updatedRefs
          }
        }
      });

      console.log(`Updated app references for field: ${field.label}`);
    }
  }
}
```

### 2.4 Complete Structure Migration

```javascript
async function migrateWorkspaceStructure(api, sourceSpaceId, targetSpaceId, migrationPlan) {
  // Get all apps in source space
  const sourceApps = await api.get(`/app/space/${sourceSpaceId}/`);

  // Get app details with dependencies
  const appDetails = [];
  for (const app of sourceApps) {
    const detail = await api.get(`/app/${app.app_id}`);
    appDetails.push(detail);
  }

  // Analyze dependencies
  const dependencies = analyzeAppDependencies(appDetails.map(d => ({ app: d })));

  // Get migration order
  const migrationOrder = getAppMigrationOrder(dependencies);

  // Clone apps in order
  for (const appId of migrationOrder) {
    await cloneApp(api, appId, targetSpaceId, migrationPlan);
  }

  // Fix all app references
  for (const [sourceAppId, targetAppId] of migrationPlan.appMappings) {
    await fixAppReferences(api, targetAppId, migrationPlan);
  }

  console.log(`Migrated ${sourceApps.length} applications`);
}
```

## Phase 3: Workflow Migration

### 3.1 Migrate Flows

```javascript
async function migrateFlows(api, sourceAppId, targetAppId, migrationPlan) {
  // Get flows from source app
  const sourceFlows = await api.get(`/flow/app/${sourceAppId}/`);

  const results = [];

  for (const flow of sourceFlows) {
    try {
      // Map flow configuration
      const mappedFlow = mapFlowConfiguration(flow, sourceAppId, migrationPlan);

      // Create flow in target app
      const newFlow = await api.post(`/flow/app/${targetAppId}/`, mappedFlow);

      results.push({
        success: true,
        sourceId: flow.flow_id,
        targetId: newFlow.flow_id,
        name: flow.name
      });

      console.log(`✓ Migrated flow: ${flow.name}`);
    } catch (error) {
      results.push({
        success: false,
        sourceId: flow.flow_id,
        name: flow.name,
        error: error.message
      });

      console.error(`✗ Failed to migrate flow: ${flow.name}`, error.message);
    }
  }

  return results;
}

function mapFlowConfiguration(flow, sourceAppId, migrationPlan) {
  return {
    type: flow.type,
    name: flow.name,
    effects: flow.effects.map(effect => mapFlowEffect(effect, sourceAppId, migrationPlan)),
    filters: mapFlowFilters(flow.filters, sourceAppId, migrationPlan)
  };
}

function mapFlowEffect(effect, sourceAppId, migrationPlan) {
  const config = { ...effect.config };

  // Map field references in text fields
  ['text', 'description', 'value', 'subject'].forEach(key => {
    if (config[key]) {
      config[key] = mapFieldReferences(config[key], sourceAppId, migrationPlan);
    }
  });

  // Map responsible/participants
  if (config.responsible) {
    config.responsible = mapFieldReferences(config.responsible, sourceAppId, migrationPlan);
  }

  // Map field_updates
  if (config.field_updates) {
    const mapped = {};
    Object.keys(config.field_updates).forEach(fieldExternalId => {
      // External IDs should remain the same if fields were cloned properly
      mapped[fieldExternalId] = config.field_updates[fieldExternalId];
    });
    config.field_updates = mapped;
  }

  return { type: effect.type, config };
}

function mapFieldReferences(text, sourceAppId, migrationPlan) {
  // Field references use external_id (@field-external-id)
  // These should remain the same if apps were cloned with same external_ids
  return text;
}

function mapFlowFilters(filters, sourceAppId, migrationPlan) {
  if (!filters) return null;

  // Filters use external_ids, so should remain the same
  return filters;
}
```

### 3.2 Migrate Hooks

```javascript
async function migrateHooks(api, sourceAppId, targetAppId) {
  // Get hooks from source app
  const sourceHooks = await api.get(`/hook/app/${sourceAppId}/`);

  const results = [];

  for (const hook of sourceHooks) {
    // Only migrate active hooks
    if (hook.status !== 'active') {
      console.log(`Skipping inactive hook: ${hook.type}`);
      continue;
    }

    try {
      // Create hook in target app
      const newHook = await api.post(`/hook/app/${targetAppId}/`, {
        url: hook.url,
        type: hook.type
      });

      results.push({
        success: true,
        sourceId: hook.hook_id,
        targetId: newHook.hook_id,
        type: hook.type,
        url: hook.url,
        needsVerification: true
      });

      console.log(`✓ Created hook: ${hook.type} -> ${hook.url}`);
      console.log(`  ⚠ Verification required for hook ${newHook.hook_id}`);
    } catch (error) {
      results.push({
        success: false,
        sourceId: hook.hook_id,
        type: hook.type,
        error: error.message
      });

      console.error(`✗ Failed to create hook: ${hook.type}`, error.message);
    }
  }

  return results;
}
```

### 3.3 Complete Workflow Migration

```javascript
async function migrateAllWorkflows(api, migrationPlan) {
  const workflowResults = {
    flows: [],
    hooks: []
  };

  for (const [sourceAppId, targetAppId] of migrationPlan.appMappings) {
    console.log(`\nMigrating workflows for app ${sourceAppId} -> ${targetAppId}`);

    // Migrate flows
    const flowResults = await migrateFlows(api, sourceAppId, targetAppId, migrationPlan);
    workflowResults.flows.push(...flowResults);

    // Migrate hooks
    const hookResults = await migrateHooks(api, sourceAppId, targetAppId);
    workflowResults.hooks.push(...hookResults);
  }

  return workflowResults;
}
```

## Phase 4: Data Migration (Optional)

### 4.1 Migrate Items

```javascript
async function migrateItems(api, sourceAppId, targetAppId, migrationPlan, options = {}) {
  const { batchSize = 100, includeComments = false } = options;

  // Get all items from source
  const items = await getAllItems(api, sourceAppId);

  console.log(`Migrating ${items.length} items...`);

  const results = [];

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);

    for (const item of batch) {
      try {
        const newItem = await copyItem(api, item, sourceAppId, targetAppId, migrationPlan);

        results.push({
          success: true,
          sourceId: item.item_id,
          targetId: newItem.item_id
        });

        // Store item mapping for reference fields
        migrationPlan.itemMappings.set(item.item_id, newItem.item_id);
      } catch (error) {
        results.push({
          success: false,
          sourceId: item.item_id,
          error: error.message
        });
      }
    }

    console.log(`Progress: ${Math.min(i + batchSize, items.length)}/${items.length}`);
  }

  return results;
}

async function getAllItems(api, appId) {
  const allItems = [];
  let offset = 0;
  const limit = 500;

  while (true) {
    const response = await api.post(`/item/app/${appId}/filter/`, {
      limit,
      offset
    });

    allItems.push(...response.items);

    if (response.filtered <= offset + limit) {
      break;
    }

    offset += limit;
  }

  return allItems;
}

async function copyItem(api, sourceItem, sourceAppId, targetAppId, migrationPlan) {
  const fields = {};

  sourceItem.fields.forEach(field => {
    if (!field.values || field.values.length === 0) return;

    // Map field value based on type
    const value = extractFieldValue(field, migrationPlan);

    if (value !== null) {
      fields[field.external_id] = value;
    }
  });

  return api.post(`/item/app/${targetAppId}/`, {
    fields,
    external_id: sourceItem.external_id || `migrated-${sourceItem.item_id}`
  });
}

function extractFieldValue(field, migrationPlan) {
  if (!field.values || field.values.length === 0) return null;

  switch (field.type) {
    case 'text':
    case 'number':
      return field.values[0].value;

    case 'date':
      return {
        start: field.values[0].start,
        end: field.values[0].end
      };

    case 'category':
      return field.values.map(v => v.value.id);

    case 'app':
      // Map referenced items if they were migrated
      return field.values.map(v => {
        const sourceItemId = v.value.item_id;
        const targetItemId = migrationPlan.itemMappings.get(sourceItemId);
        return targetItemId || sourceItemId; // Use source if not migrated yet
      });

    case 'money':
      return {
        value: field.values[0].value,
        currency: field.values[0].currency
      };

    case 'location':
    case 'duration':
    case 'contact':
      return field.values[0].value;

    default:
      return field.values[0].value;
  }
}
```

## Phase 5: Validation & Testing

### 5.1 Verify Workflow Migration

```javascript
async function validateMigration(api, migrationPlan) {
  const validation = {
    apps: [],
    flows: [],
    hooks: []
  };

  for (const [sourceAppId, targetAppId] of migrationPlan.appMappings) {
    // Verify app exists and structure matches
    const targetApp = await api.get(`/app/${targetAppId}`);
    const sourceApp = await api.get(`/app/${sourceAppId}`);

    validation.apps.push({
      sourceId: sourceAppId,
      targetId: targetAppId,
      fieldsMatch: targetApp.fields.length === sourceApp.fields.length
    });

    // Verify flows
    const targetFlows = await api.get(`/flow/app/${targetAppId}/`);
    const sourceFlows = await api.get(`/flow/app/${sourceAppId}/`);

    validation.flows.push({
      sourceAppId,
      targetAppId,
      sourceCount: sourceFlows.length,
      targetCount: targetFlows.length,
      match: targetFlows.length === sourceFlows.length
    });

    // Verify hooks (check creation, not verification status)
    const targetHooks = await api.get(`/hook/app/${targetAppId}/`);
    const sourceHooks = await api.get(`/hook/app/${sourceAppId}/`).then(hooks =>
      hooks.filter(h => h.status === 'active')
    );

    const needsVerification = targetHooks.filter(h => h.status !== 'active');

    validation.hooks.push({
      sourceAppId,
      targetAppId,
      sourceCount: sourceHooks.length,
      targetCount: targetHooks.length,
      needsVerification: needsVerification.length
    });
  }

  return validation;
}
```

### 5.2 Test Workflows

```javascript
async function testWorkflows(api, targetAppId) {
  console.log(`\nTesting workflows for app ${targetAppId}...`);

  // Create a test item to trigger flows
  const testItem = await api.post(`/item/app/${targetAppId}/`, {
    fields: {
      title: 'Test Item - Workflow Verification'
    }
  });

  console.log(`Created test item: ${testItem.item_id}`);
  console.log('⚠ Check if flows triggered correctly:');
  console.log('  - Tasks created');
  console.log('  - Status updates posted');
  console.log('  - Comments added');
  console.log('  - Webhooks called');

  // Update test item to trigger update flows
  await api.put(`/item/${testItem.item_id}`, {
    fields: {
      title: 'Test Item - Updated'
    }
  });

  console.log('Updated test item - check update flows');

  // Clean up
  await api.delete(`/item/${testItem.item_id}`);
  console.log('Deleted test item');
}
```

## Complete Migration Script

```javascript
class WorkflowMigrator {
  constructor(apiClient) {
    this.api = apiClient;
  }

  async migrateWorkspace(sourceOrgId, sourceSpaceId, targetOrgId, targetSpaceId, options = {}) {
    console.log('=== Starting Workspace Migration ===\n');

    // Phase 1: Discovery
    console.log('Phase 1: Discovery & Planning');
    const migrationPlan = new MigrationPlan(sourceOrgId, sourceSpaceId, targetOrgId, targetSpaceId);

    // Phase 2: Structure Migration
    console.log('\nPhase 2: Structure Migration');
    const targetSpace = await ensureTargetSpace(this.api, targetOrgId, options.spaceName || 'Migrated Workspace');
    migrationPlan.target.spaceId = targetSpace.space_id;

    await migrateWorkspaceStructure(this.api, sourceSpaceId, targetSpace.space_id, migrationPlan);

    // Phase 3: Workflow Migration
    console.log('\nPhase 3: Workflow Migration');
    const workflowResults = await migrateAllWorkflows(this.api, migrationPlan);

    // Phase 4: Data Migration (optional)
    if (options.migrateItems) {
      console.log('\nPhase 4: Data Migration');
      for (const [sourceAppId, targetAppId] of migrationPlan.appMappings) {
        await migrateItems(this.api, sourceAppId, targetAppId, migrationPlan);
      }
    }

    // Phase 5: Validation
    console.log('\nPhase 5: Validation');
    const validation = await validateMigration(this.api, migrationPlan);

    // Summary
    console.log('\n=== Migration Summary ===');
    console.log(`Apps migrated: ${migrationPlan.appMappings.size}`);
    console.log(`Flows migrated: ${workflowResults.flows.filter(f => f.success).length}`);
    console.log(`Hooks migrated: ${workflowResults.hooks.filter(h => h.success).length}`);

    const hooksNeedingVerification = workflowResults.hooks.filter(h => h.needsVerification);
    if (hooksNeedingVerification.length > 0) {
      console.log(`\n⚠ ${hooksNeedingVerification.length} hooks need verification`);
    }

    return {
      migrationPlan,
      workflowResults,
      validation
    };
  }
}

// Usage
async function main() {
  const api = new PodioAPIClient(clientId, clientSecret);
  await api.authenticate(username, password);

  const migrator = new WorkflowMigrator(api);

  const result = await migrator.migrateWorkspace(
    sourceOrgId: 12345,
    sourceSpaceId: 67890,
    targetOrgId: 54321,
    targetSpaceId: null, // Will create new space
    {
      spaceName: 'Migrated Workflows',
      migrateItems: false // Set to true to also migrate data
    }
  );

  console.log('\nMigration complete!');
}
```

## Post-Migration Checklist

- [ ] Verify all apps created successfully
- [ ] Confirm field mappings are correct
- [ ] Check app reference fields point to correct apps
- [ ] Validate all flows migrated
- [ ] Verify flow field references are correct
- [ ] Confirm all hooks created
- [ ] Verify webhooks (check verification status)
- [ ] Test workflows with sample items
- [ ] Update webhook handlers if needed
- [ ] Document any manual adjustments required
- [ ] Train users on new workspace

## Common Issues & Solutions

### Issue: App Reference Fields Not Working
**Solution**: Run `fixAppReferences()` again to ensure all references updated

### Issue: Flows Not Triggering
**Solution**: Check field references in flow configuration - ensure external_ids match

### Issue: Hooks Not Verified
**Solution**: Manually trigger verification or check webhook endpoint is accessible

### Issue: Field Values Not Mapping
**Solution**: Verify field types match between source and target apps

### Issue: Circular Dependencies
**Solution**: Break circular references temporarily, migrate, then restore

## Best Practices

1. **Test First**: Always test migration on a small workspace first
2. **Backup**: Document source workspace before migration
3. **Incremental**: Migrate in phases - structure, then workflows, then data
4. **Validate**: Check each phase before proceeding
5. **External IDs**: Ensure all fields have external_ids for stable references
6. **Naming**: Keep consistent naming or add clear prefixes/suffixes
7. **Documentation**: Document any manual steps or customizations
8. **Communication**: Inform users of migration timeline and testing phase

## Limitations

- **Globiflow-Specific Features**: If using Globiflow extensions beyond standard Podio Flows, those may need manual recreation
- **Calculated Fields**: Calculation scripts are copied but verify they work correctly
- **Views**: App views are copied but may need adjustment
- **Permissions**: Member permissions must be configured manually in target workspace
- **History**: Item revisions and history are not migrated
- **Comments**: Comments are not migrated unless explicitly coded
