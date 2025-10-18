# Flows API (Podio Native Flows)

> ⚠️ **IMPORTANT**: This document describes **Podio's native Flows API**, NOT Globiflow (Podio Workflow Automation). These are two completely different systems:
>
> - **Podio Native Flows** (this document): Simple workflows accessible via REST API with basic triggers and effects
> - **Globiflow** (see `10-globiflow-workflow-automation.md`): Advanced workflow automation with collectors, logic operations, and 24+ actions - **NO PUBLIC API**
>
> Most Podio Premium users use **Globiflow**, not the native Flows API documented here.

## Overview
Flows are Podio's **native** workflow automation system (distinct from Globiflow). They define automated actions (effects) triggered by specific events (causes) within applications using a simple REST API.

## Flow Structure
```
Flow
  ├── Cause (Trigger)
  │   └── When: item.create, item.update, or item.delete
  └── Effect (Action)
      └── What: task.create, item.update, status.create, etc.
```

## Key Concepts

### Causes (Triggers)
Events that initiate a flow:
- **item.create**: When a new item is created in the app
- **item.update**: When an item is modified
- **item.delete**: When an item is deleted

### Effects (Actions)
Automated actions performed when triggered:
- **task.create**: Create a new task
- **item.update**: Update an item
- **status.create**: Post a status update
- **comment.create**: Add a comment
- **conversation.create**: Start a conversation
- **octoblu.trigger**: Call external webhook URL

## Endpoints

### Get Flows
Get all flows for an application.

```http
GET https://api.podio.com/flow/app/{app_id}/
Authorization: OAuth2 ACCESS_TOKEN
```

**Response:**
```json
[
  {
    "flow_id": 123,
    "name": "Create Task on New Item",
    "type": "item.create",
    "effects": [
      {
        "effect_id": 456,
        "type": "task.create",
        "config": {
          "text": "Review @title",
          "description": "Please review this new item",
          "responsible": "@created-by",
          "due_date": "5",
          "due_time": "17:00"
        }
      }
    ],
    "active": true
  }
]
```

### Get Flow by ID
```http
GET https://api.podio.com/flow/{flow_id}
Authorization: OAuth2 ACCESS_TOKEN
```

### Add New Flow
```http
POST https://api.podio.com/flow/app/{app_id}/
Authorization: OAuth2 ACCESS_TOKEN
Content-Type: application/json

{
  "type": "item.create",
  "name": "Auto-assign tasks",
  "effects": [
    {
      "type": "task.create",
      "config": {
        "text": "Review @title",
        "description": "New item needs review",
        "responsible": "@assigned-to",
        "due_date": "3"
      }
    }
  ]
}
```

### Update Flow
```http
PUT https://api.podio.com/flow/{flow_id}
Authorization: OAuth2 ACCESS_TOKEN
Content-Type: application/json

{
  "name": "Updated Flow Name",
  "effects": [
    {
      "type": "task.create",
      "config": {
        "text": "Updated task text"
      }
    }
  ]
}
```

### Delete Flow
```http
DELETE https://api.podio.com/flow/{flow_id}
Authorization: OAuth2 ACCESS_TOKEN
```

### Get Flow Context
Get available variables and fields for flow configuration.

```http
GET https://api.podio.com/flow/app/{app_id}/context/{cause}
Authorization: OAuth2 ACCESS_TOKEN
```

**Example:**
```http
GET https://api.podio.com/flow/app/12345/context/item.create
```

**Response:**
```json
{
  "fields": [
    {
      "external_id": "title",
      "label": "Title",
      "type": "text"
    },
    {
      "external_id": "assigned-to",
      "label": "Assigned To",
      "type": "contact"
    }
  ],
  "variables": [
    {
      "key": "@created-by",
      "label": "Created By",
      "type": "contact"
    },
    {
      "key": "@current-date",
      "label": "Current Date",
      "type": "date"
    }
  ]
}
```

### Get Effect Attributes
Get available configuration options for an effect type.

```http
GET https://api.podio.com/flow/app/{app_id}/effect/{effect}
Authorization: OAuth2 ACCESS_TOKEN
```

**Example:**
```http
GET https://api.podio.com/flow/app/12345/effect/task.create
```

## Flow Effects

### task.create
Create a task when flow is triggered.

```json
{
  "type": "task.create",
  "config": {
    "text": "Task title with @field-reference",
    "description": "Task description",
    "responsible": "@assigned-to",
    "due_date": "5",
    "due_time": "17:00",
    "private": false
  }
}
```

**Config Options:**
- `text` (required): Task title, supports field references
- `description`: Task description
- `responsible`: Contact field or variable (e.g., `@assigned-to`, `@created-by`)
- `due_date`: Number of days from trigger (e.g., "5" = 5 days from now)
- `due_time`: Time in HH:MM format
- `private`: Boolean, default false

### item.update
Update the item that triggered the flow.

```json
{
  "type": "item.update",
  "config": {
    "field_updates": {
      "status": 2,
      "last-processed": "@current-date"
    },
    "tags": {
      "add": ["automated", "processed"]
    }
  }
}
```

**Config Options:**
- `field_updates`: Object mapping field external_id to new values
- `tags.add`: Array of tags to add
- `tags.remove`: Array of tags to remove

### status.create
Post a status update to the item's space.

```json
{
  "type": "status.create",
  "config": {
    "value": "New item created: @title",
    "alert": ["@assigned-to"]
  }
}
```

**Config Options:**
- `value` (required): Status text, supports field references
- `alert`: Array of contact fields/variables to notify

### comment.create
Add a comment to the item.

```json
{
  "type": "comment.create",
  "config": {
    "value": "Automated comment: @title was created",
    "alert": ["@created-by"]
  }
}
```

**Config Options:**
- `value` (required): Comment text, supports field references
- `alert`: Array of contact fields/variables to notify

### conversation.create
Start a conversation.

```json
{
  "type": "conversation.create",
  "config": {
    "subject": "Regarding @title",
    "text": "Discussion about this item",
    "participants": ["@assigned-to", "@created-by"]
  }
}
```

**Config Options:**
- `subject` (required): Conversation subject
- `text`: Initial message
- `participants`: Array of contact fields/variables

### octoblu.trigger
Call an external webhook URL.

```json
{
  "type": "octoblu.trigger",
  "config": {
    "url": "https://example.com/webhook",
    "method": "POST"
  }
}
```

**Config Options:**
- `url` (required): Webhook URL
- `method`: HTTP method (GET, POST, PUT, DELETE)

## Field References

### Syntax
Reference field values using `@external-id`:
```
"Task title: @project-name for @client-name"
```

### System Variables
- `@created-by`: User who created the item
- `@last-edited-by`: User who last edited the item
- `@current-date`: Current date
- `@current-time`: Current time

### Field References
- `@field-external-id`: Reference any field value
- Contact fields return user IDs
- Date fields return formatted dates
- Text fields return string values

## Flow Conditions

Flows can include conditions (filters) to run only when criteria are met:

```json
{
  "type": "item.create",
  "filters": {
    "status": [1, 2],
    "priority": "High"
  },
  "effects": [...]
}
```

## Use Cases for Workflow Migration

### 1. Get All Flows from Source App
```javascript
async function getAppFlows(appId) {
  const flows = await apiClient.get(`/flow/app/${appId}/`);
  console.log(`Found ${flows.length} flows in app ${appId}`);
  return flows;
}
```

### 2. Clone Flow to Target App
```javascript
async function cloneFlow(sourceFlow, targetAppId, fieldMapping) {
  // Map field references in flow configuration
  const mappedFlow = mapFlowFieldReferences(sourceFlow, fieldMapping);

  const newFlow = await apiClient.post(`/flow/app/${targetAppId}/`, {
    type: mappedFlow.type,
    name: mappedFlow.name,
    effects: mappedFlow.effects,
    filters: mappedFlow.filters
  });

  return newFlow;
}
```

### 3. Map Field References in Flow
```javascript
function mapFlowFieldReferences(flow, fieldMapping) {
  const mappedFlow = {
    type: flow.type,
    name: flow.name,
    effects: flow.effects.map(effect => mapEffectFields(effect, fieldMapping)),
    filters: mapFilters(flow.filters, fieldMapping)
  };

  return mappedFlow;
}

function mapEffectFields(effect, fieldMapping) {
  const config = { ...effect.config };

  // Replace field references in text fields
  Object.keys(config).forEach(key => {
    if (typeof config[key] === 'string') {
      config[key] = replaceFieldReferences(config[key], fieldMapping);
    }
  });

  // Map field_updates
  if (config.field_updates) {
    const mappedUpdates = {};
    Object.keys(config.field_updates).forEach(oldExternalId => {
      const newExternalId = fieldMapping[oldExternalId] || oldExternalId;
      mappedUpdates[newExternalId] = config.field_updates[oldExternalId];
    });
    config.field_updates = mappedUpdates;
  }

  return {
    type: effect.type,
    config
  };
}

function replaceFieldReferences(text, fieldMapping) {
  // Replace @field-external-id references
  return text.replace(/@([\w-]+)/g, (match, fieldId) => {
    // Don't replace system variables
    if (fieldId.startsWith('created-') || fieldId.startsWith('current-')) {
      return match;
    }
    return `@${fieldMapping[fieldId] || fieldId}`;
  });
}
```

### 4. Migrate All Flows for App
```javascript
async function migrateAppFlows(sourceAppId, targetAppId, fieldMapping) {
  const sourceFlows = await apiClient.get(`/flow/app/${sourceAppId}/`);

  const results = [];

  for (const flow of sourceFlows) {
    try {
      const newFlow = await cloneFlow(flow, targetAppId, fieldMapping);
      results.push({
        success: true,
        source: flow.flow_id,
        target: newFlow.flow_id,
        name: flow.name
      });
    } catch (error) {
      results.push({
        success: false,
        source: flow.flow_id,
        name: flow.name,
        error: error.message
      });
    }
  }

  return results;
}
```

## Best Practices

1. **Test Flows**: Create test items to verify flows work correctly
2. **Use External IDs**: Reference fields by external_id for stability
3. **Validate Field Mapping**: Ensure referenced fields exist in target app
4. **Preserve Flow Names**: Keep original names or add "(Copy)" suffix
5. **Check Conditions**: Verify filter values match target app field options
6. **Handle Webhooks**: Update octoblu.trigger URLs if needed
7. **Document Dependencies**: Note which flows depend on specific field values

## Limitations

1. **No Cross-App Triggers**: Flows only trigger within the same app
2. **Limited Conditions**: Basic filtering only, no complex logic
3. **Sequential Execution**: Effects run in order, not parallel
4. **No Loops**: Cannot create recursive or looping flows
5. **Field Reference Scope**: Can only reference fields in the triggered item

## Error Handling

### Common Errors

**400 Bad Request**: Invalid flow configuration
```json
{
  "error": "invalid_request",
  "error_description": "Invalid effect configuration",
  "error_detail": "Field reference @invalid-field does not exist"
}
```

**404 Not Found**: App or flow not found
```json
{
  "error": "not_found",
  "error_description": "App not found"
}
```

## Example: Flow Migrator

```javascript
class FlowMigrator {
  constructor(apiClient) {
    this.apiClient = apiClient;
  }

  async migrateFlows(sourceAppId, targetAppId, fieldMapping) {
    // Get all flows from source app
    const sourceFlows = await this.apiClient.get(`/flow/app/${sourceAppId}/`);

    console.log(`Migrating ${sourceFlows.length} flows...`);

    const results = {
      success: [],
      failed: []
    };

    for (const flow of sourceFlows) {
      try {
        const mappedFlow = this.mapFlow(flow, fieldMapping);
        const newFlow = await this.apiClient.post(
          `/flow/app/${targetAppId}/`,
          mappedFlow
        );

        results.success.push({
          sourceId: flow.flow_id,
          targetId: newFlow.flow_id,
          name: flow.name
        });

        console.log(`✓ Migrated flow: ${flow.name}`);
      } catch (error) {
        results.failed.push({
          sourceId: flow.flow_id,
          name: flow.name,
          error: error.message
        });

        console.error(`✗ Failed to migrate flow: ${flow.name}`, error.message);
      }
    }

    return results;
  }

  mapFlow(flow, fieldMapping) {
    return {
      type: flow.type,
      name: flow.name,
      effects: flow.effects.map(effect => this.mapEffect(effect, fieldMapping)),
      filters: this.mapFilters(flow.filters, fieldMapping)
    };
  }

  mapEffect(effect, fieldMapping) {
    const config = { ...effect.config };

    // Map text fields with @ references
    ['text', 'description', 'value', 'subject'].forEach(key => {
      if (config[key]) {
        config[key] = this.replaceFieldReferences(config[key], fieldMapping);
      }
    });

    // Map responsible/participants contact fields
    if (config.responsible) {
      config.responsible = this.replaceFieldReferences(config.responsible, fieldMapping);
    }

    // Map field_updates
    if (config.field_updates) {
      const mapped = {};
      Object.keys(config.field_updates).forEach(oldId => {
        const newId = fieldMapping[oldId] || oldId;
        mapped[newId] = config.field_updates[oldId];
      });
      config.field_updates = mapped;
    }

    return { type: effect.type, config };
  }

  mapFilters(filters, fieldMapping) {
    if (!filters) return null;

    const mapped = {};
    Object.keys(filters).forEach(oldId => {
      const newId = fieldMapping[oldId] || oldId;
      mapped[newId] = filters[oldId];
    });

    return mapped;
  }

  replaceFieldReferences(text, fieldMapping) {
    if (!text) return text;

    return text.replace(/@([\w-]+)/g, (match, fieldId) => {
      // Preserve system variables
      const systemVars = ['created-by', 'last-edited-by', 'current-date', 'current-time'];
      if (systemVars.includes(fieldId)) {
        return match;
      }

      // Map field reference
      return `@${fieldMapping[fieldId] || fieldId}`;
    });
  }
}
```
