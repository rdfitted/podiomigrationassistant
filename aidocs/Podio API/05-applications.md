# Applications API

## Overview
Applications (apps) define the structure for data in Podio. Think of them as database tables with customizable fields. Each app lives within a space and contains items (records).

## Hierarchy
```
Space
  └── Application
      └── Items (Records)
```

## Key Endpoints

### Get Application
```http
GET https://api.podio.com/app/{app_id}
Authorization: OAuth2 ACCESS_TOKEN
```

**Response:**
```json
{
  "app_id": 12345,
  "space_id": 67890,
  "config": {
    "name": "Projects",
    "item_name": "Project",
    "description": "Track all our projects",
    "usage": "Add a new project for each client engagement",
    "icon": "327.png",
    "allow_edit": true,
    "default_view": "table"
  },
  "fields": [
    {
      "field_id": 111,
      "type": "text",
      "external_id": "project-name",
      "label": "Project Name",
      "config": {
        "required": true,
        "description": "The name of the project",
        "size": "large"
      }
    },
    {
      "field_id": 112,
      "type": "date",
      "external_id": "due-date",
      "label": "Due Date",
      "config": {
        "required": false,
        "calendar": true
      }
    }
  ],
  "rights": ["view", "update", "delete", "..."]
}
```

### Get Apps by Space
```http
GET https://api.podio.com/app/space/{space_id}/
Authorization: OAuth2 ACCESS_TOKEN
```

**Response:**
```json
[
  {
    "app_id": 12345,
    "config": {
      "name": "Projects"
    },
    "link": "https://podio.com/acme/marketing/apps/projects"
  },
  {
    "app_id": 12346,
    "config": {
      "name": "Contacts"
    }
  }
]
```

### Get App by URL Label
```http
GET https://api.podio.com/app/org/{org_id}/space/{space_url_label}/{app_url_label}
Authorization: OAuth2 ACCESS_TOKEN
```

### Get All Apps
Get all apps accessible to the authenticated user.

```http
GET https://api.podio.com/app/
Authorization: OAuth2 ACCESS_TOKEN
```

### Get Top Apps
Most frequently used apps.

```http
GET https://api.podio.com/app/top/
Authorization: OAuth2 ACCESS_TOKEN
```

## Application Management

### Add New App
```http
POST https://api.podio.com/app/space/{space_id}/
Authorization: OAuth2 ACCESS_TOKEN
Content-Type: application/json

{
  "config": {
    "name": "Projects",
    "item_name": "Project",
    "description": "Track projects",
    "icon": "327.png",
    "allow_edit": true,
    "default_view": "table"
  },
  "fields": [
    {
      "type": "text",
      "external_id": "title",
      "config": {
        "label": "Title",
        "required": true,
        "size": "large"
      }
    },
    {
      "type": "date",
      "external_id": "due-date",
      "config": {
        "label": "Due Date",
        "required": false
      }
    }
  ]
}
```

### Update App
```http
PUT https://api.podio.com/app/{app_id}
Authorization: OAuth2 ACCESS_TOKEN
Content-Type: application/json

{
  "config": {
    "name": "Updated App Name",
    "description": "Updated description"
  }
}
```

### Delete App
```http
DELETE https://api.podio.com/app/{app_id}
Authorization: OAuth2 ACCESS_TOKEN
```

### Activate App
```http
POST https://api.podio.com/app/{app_id}/activate
Authorization: OAuth2 ACCESS_TOKEN
```

### Deactivate App
```http
POST https://api.podio.com/app/{app_id}/deactivate
Authorization: OAuth2 ACCESS_TOKEN
```

### Install App
Install an app from app market or copy from another space.

```http
POST https://api.podio.com/app/{app_id}/install
Authorization: OAuth2 ACCESS_TOKEN
Content-Type: application/json

{
  "space_id": 67890,
  "dependencies": true
}
```

## Field Types

### Text
```json
{
  "type": "text",
  "config": {
    "label": "Field Name",
    "description": "Helper text",
    "required": true,
    "size": "small|large",
    "delta": 0
  }
}
```

### Number
```json
{
  "type": "number",
  "config": {
    "label": "Quantity",
    "decimals": 2
  }
}
```

### Date
```json
{
  "type": "date",
  "config": {
    "label": "Due Date",
    "calendar": true,
    "end": "enabled|disabled",
    "time": "enabled|disabled"
  }
}
```

### Category
```json
{
  "type": "category",
  "config": {
    "label": "Status",
    "settings": {
      "multiple": false,
      "options": [
        { "text": "Active", "color": "green" },
        { "text": "On Hold", "color": "yellow" },
        { "text": "Complete", "color": "blue" }
      ]
    }
  }
}
```

### App Reference (Relationship)
```json
{
  "type": "app",
  "config": {
    "label": "Related Items",
    "settings": {
      "referenced_apps": [
        { "app_id": 54321 }
      ],
      "multiple": true
    }
  }
}
```

### Contact
```json
{
  "type": "contact",
  "config": {
    "label": "Assigned To",
    "settings": {
      "type": "space_users|space_contacts|all_users",
      "multiple": true
    }
  }
}
```

### Money
```json
{
  "type": "money",
  "config": {
    "label": "Budget",
    "settings": {
      "allowed_currencies": ["USD", "EUR", "GBP"]
    }
  }
}
```

### Progress
```json
{
  "type": "progress",
  "config": {
    "label": "Completion"
  }
}
```

### Location
```json
{
  "type": "location",
  "config": {
    "label": "Address"
  }
}
```

### Duration
```json
{
  "type": "duration",
  "config": {
    "label": "Time Spent",
    "fields": ["days", "hours", "minutes"]
  }
}
```

### Calculation
```json
{
  "type": "calculation",
  "config": {
    "label": "Total",
    "script": "return @quantity * @price;"
  }
}
```

### Embed
```json
{
  "type": "embed",
  "config": {
    "label": "Video"
  }
}
```

### Question (Yes/No)
```json
{
  "type": "question",
  "config": {
    "label": "Approved?"
  }
}
```

### File/Image
```json
{
  "type": "image",
  "config": {
    "label": "Screenshots"
  }
}
```

### Telephone
```json
{
  "type": "tel",
  "config": {
    "label": "Phone Number"
  }
}
```

## App Configuration

### Config Options
- `name`: App display name
- `item_name`: Singular name for items (e.g., "Project")
- `description`: App description
- `usage`: Instructions for users
- `icon`: Icon filename
- `allow_edit`: Users can edit items (default: true)
- `allow_create`: Users can create items (default: true)
- `allow_attachments`: Allow file attachments (default: true)
- `allow_comments`: Allow comments (default: true)
- `show_app_item_id`: Show numeric item IDs (default: false)
- `default_view`: Default view mode ("table"|"badge"|"stream"|"calendar"|"card")
- `tasks`: Task settings
- `references`: Reference settings
- `fivestar`: Rating settings
- `approved`: Approval workflow settings
- `thumbs`: Like/dislike settings
- `rsvp`: RSVP settings

### View Modes
- **table**: Spreadsheet-like grid
- **badge**: Card/badge view
- **stream**: Activity stream
- **calendar**: Calendar view (requires date field)
- **card**: Kanban-style cards

## App Fields Management

### Add Field to App
```http
POST https://api.podio.com/app/{app_id}/field/
Authorization: OAuth2 ACCESS_TOKEN
Content-Type: application/json

{
  "type": "text",
  "external_id": "new-field",
  "config": {
    "label": "New Field",
    "required": false
  }
}
```

### Update App Field
```http
PUT https://api.podio.com/app/{app_id}/field/{field_id}
Authorization: OAuth2 ACCESS_TOKEN
Content-Type: application/json

{
  "config": {
    "label": "Updated Label",
    "required": true
  }
}
```

### Delete App Field
```http
DELETE https://api.podio.com/app/{app_id}/field/{field_id}
Authorization: OAuth2 ACCESS_TOKEN
```

## Use Cases for Workflow Migration

### 1. Get Source App Structure
```javascript
async function getAppStructure(appId) {
  const app = await apiClient.get(`/app/${appId}`);

  return {
    config: app.config,
    fields: app.fields.map(f => ({
      type: f.type,
      external_id: f.external_id,
      config: f.config
    }))
  };
}
```

### 2. Clone App to Different Space
```javascript
async function cloneApp(sourceAppId, targetSpaceId) {
  const sourceApp = await apiClient.get(`/app/${sourceAppId}`);

  // Create new app with same structure
  const newApp = await apiClient.post(`/app/space/${targetSpaceId}/`, {
    config: {
      ...sourceApp.config,
      name: `${sourceApp.config.name} (Copy)`
    },
    fields: sourceApp.fields.map(f => ({
      type: f.type,
      external_id: f.external_id,
      config: f.config
    }))
  });

  return newApp;
}
```

### 3. Map Fields Between Apps
```javascript
async function createFieldMapping(sourceAppId, targetAppId) {
  const [sourceApp, targetApp] = await Promise.all([
    apiClient.get(`/app/${sourceAppId}`),
    apiClient.get(`/app/${targetAppId}`)
  ]);

  const mapping = {};

  sourceApp.fields.forEach(sourceField => {
    const targetField = targetApp.fields.find(
      f => f.external_id === sourceField.external_id
    );

    if (targetField) {
      mapping[sourceField.field_id] = targetField.field_id;
    }
  });

  return mapping;
}
```

### 4. Update App Reference Fields
When cloning apps, update app reference fields to point to correct apps.

```javascript
async function updateAppReferences(appId, fieldId, newReferencedAppIds) {
  await apiClient.put(`/app/${appId}/field/${fieldId}`, {
    config: {
      settings: {
        referenced_apps: newReferencedAppIds.map(id => ({ app_id: id }))
      }
    }
  });
}
```

## Best Practices

1. **Use External IDs**: Set `external_id` on fields for stable references
2. **Plan Field Order**: Fields are displayed in array order
3. **Validate Before Create**: Ensure field types are compatible
4. **Handle Calculations Carefully**: Calculation scripts reference other fields
5. **Test App References**: Verify referenced apps exist before creating relationships
6. **Preserve Field IDs in Mapping**: Map old field IDs to new ones for data migration
7. **Clone vs Install**: Use install for app market apps, clone for custom apps

## Error Handling

### Common Errors

**400 Bad Request**: Invalid field configuration
```json
{
  "error": "invalid_request",
  "error_description": "Invalid field type or configuration"
}
```

**403 Forbidden**: Insufficient permissions
```json
{
  "error": "forbidden",
  "error_description": "User cannot modify app"
}
```

**409 Conflict**: External ID already exists
```json
{
  "error": "conflict",
  "error_description": "Field with external_id already exists"
}
```

## Example: App Cloner

```javascript
class AppCloner {
  constructor(apiClient) {
    this.apiClient = apiClient;
  }

  async cloneAppStructure(sourceAppId, targetSpaceId, namePrefix = '') {
    // Get source app
    const sourceApp = await this.apiClient.get(`/app/${sourceAppId}`);

    // Prepare app config
    const appConfig = {
      config: {
        ...sourceApp.config,
        name: `${namePrefix}${sourceApp.config.name}`
      },
      fields: sourceApp.fields.map(field => this.cloneField(field))
    };

    // Create new app
    const newApp = await this.apiClient.post(
      `/app/space/${targetSpaceId}/`,
      appConfig
    );

    console.log(`Cloned app: ${sourceApp.config.name} -> ${newApp.app_id}`);

    return {
      sourceApp,
      newApp,
      fieldMapping: this.createFieldMapping(sourceApp, newApp)
    };
  }

  cloneField(field) {
    // Remove server-generated properties
    const { field_id, ...fieldDef } = field;

    // Clone field configuration
    return {
      type: fieldDef.type,
      external_id: fieldDef.external_id,
      config: { ...fieldDef.config }
    };
  }

  createFieldMapping(sourceApp, targetApp) {
    const mapping = {};

    sourceApp.fields.forEach((sourceField, index) => {
      mapping[sourceField.field_id] = targetApp.fields[index].field_id;
    });

    return mapping;
  }

  async fixAppReferences(appId, fieldMapping, appMapping) {
    const app = await this.apiClient.get(`/app/${appId}`);

    for (const field of app.fields) {
      if (field.type === 'app' && field.config.settings.referenced_apps) {
        const updatedRefs = field.config.settings.referenced_apps.map(ref => {
          const newAppId = appMapping[ref.app_id];
          return { app_id: newAppId || ref.app_id };
        });

        await this.apiClient.put(`/app/${appId}/field/${field.field_id}`, {
          config: {
            settings: {
              referenced_apps: updatedRefs
            }
          }
        });
      }
    }
  }
}
```
