# Items API

## Overview
Items are individual records (rows) within an application. They contain field values and support comments, files, tasks, and other collaborative features.

## Hierarchy
```
Application
  └── Item (Record/Row)
      ├── Field Values
      ├── Comments
      ├── Files
      ├── Tasks
      └── Revisions
```

## Key Endpoints

### Get Item
```http
GET https://api.podio.com/item/{item_id}
Authorization: OAuth2 ACCESS_TOKEN
```

**Response:**
```json
{
  "item_id": 12345,
  "app_item_id": 1,
  "app": {
    "app_id": 54321,
    "config": {
      "name": "Projects"
    }
  },
  "fields": [
    {
      "field_id": 111,
      "external_id": "title",
      "type": "text",
      "label": "Title",
      "values": [
        {
          "value": "Project Alpha"
        }
      ]
    },
    {
      "field_id": 112,
      "external_id": "due-date",
      "type": "date",
      "label": "Due Date",
      "values": [
        {
          "start": "2025-12-31 00:00:00",
          "end": null
        }
      ]
    }
  ],
  "created_on": "2025-01-15 10:30:00",
  "created_by": {
    "user_id": 789,
    "name": "John Doe"
  },
  "link": "https://podio.com/acme/marketing/apps/projects/items/1",
  "rights": ["view", "update", "delete", "..."]
}
```

### Get Item by App Item ID
```http
GET https://api.podio.com/app/{app_id}/item/{app_item_id}
Authorization: OAuth2 ACCESS_TOKEN
```

### Get Item by External ID
```http
GET https://api.podio.com/item/app/{app_id}/external_id/{external_id}
Authorization: OAuth2 ACCESS_TOKEN
```

### Filter Items
```http
POST https://api.podio.com/item/app/{app_id}/filter/
Authorization: OAuth2 ACCESS_TOKEN
Content-Type: application/json

{
  "filters": {
    "field-external-id": "value",
    "created_on": {
      "from": "2025-01-01",
      "to": "2025-12-31"
    }
  },
  "sort_by": "created_on",
  "sort_desc": true,
  "limit": 30,
  "offset": 0
}
```

**Response:**
```json
{
  "filtered": 150,
  "total": 500,
  "items": [
    {
      "item_id": 12345,
      "fields": [...]
    }
  ]
}
```

### Filter Items by View
Use a predefined app view for filtering.

```http
POST https://api.podio.com/item/app/{app_id}/filter/{view_id}/
Authorization: OAuth2 ACCESS_TOKEN
```

### Get Item Count
```http
GET https://api.podio.com/item/app/{app_id}/count
Authorization: OAuth2 ACCESS_TOKEN
```

## Item Operations

### Add New Item
```http
POST https://api.podio.com/item/app/{app_id}/
Authorization: OAuth2 ACCESS_TOKEN
Content-Type: application/json

{
  "fields": {
    "title": "New Project",
    "due-date": {
      "start": "2025-12-31"
    },
    "status": 1
  },
  "external_id": "project-001"
}
```

**Field Value Formats by Type:**

**Text:**
```json
"field-external-id": "text value"
```

**Number:**
```json
"quantity": 42
```

**Date:**
```json
"due-date": {
  "start": "2025-12-31 09:00:00",
  "end": "2025-12-31 17:00:00"
}
// Time component is optional - can use just date:
"due-date": {
  "start": "2025-12-31"
}
// For single date (no range):
"due-date": "2025-12-31 09:00:00"
```

**Category:**
```json
"status": 1  // Option ID
// or
"status": [1, 2, 3]  // Multiple options
```

**App Reference:**
```json
"related-items": [12345, 67890]  // Item IDs
```

**Contact:**
```json
"assigned-to": [123, 456]  // User/Contact IDs
```

**Money:**
```json
"budget": {
  "value": 10000,
  "currency": "USD"
}
```

**Location:**
```json
"address": {
  "value": "123 Main St, City, State 12345",
  "formatted": "123 Main St...",
  "street_number": "123",
  "street_name": "Main St",
  "city": "City",
  "state": "State",
  "postal_code": "12345",
  "country": "US",
  "lat": 37.7749,
  "lng": -122.4194
}
```

**Duration:**
```json
"time-spent": {
  "days": 2,
  "hours": 3,
  "minutes": 30
}
```

**Question (Yes/No):**
```json
"approved": true
```

### Update Item
```http
PUT https://api.podio.com/item/{item_id}
Authorization: OAuth2 ACCESS_TOKEN
Content-Type: application/json

{
  "fields": {
    "title": "Updated Title",
    "status": 2
  }
}
```

### Update Item Field Values
Update specific fields without affecting others.

```http
PUT https://api.podio.com/item/{item_id}/value
Authorization: OAuth2 ACCESS_TOKEN
Content-Type: application/json

{
  "field-external-id": "new value"
}
```

### Update Item Values (Alternative)
```http
PUT https://api.podio.com/item/{item_id}/value/{field_id}
Authorization: OAuth2 ACCESS_TOKEN
Content-Type: application/json

{
  "value": "new value"
}
```

### Delete Item
```http
DELETE https://api.podio.com/item/{item_id}
Authorization: OAuth2 ACCESS_TOKEN
```

### Bulk Delete Items
```http
POST https://api.podio.com/item/app/{app_id}/delete
Authorization: OAuth2 ACCESS_TOKEN
Content-Type: application/json

{
  "item_ids": [12345, 67890, 11111]
}
```

## Advanced Operations

### Clone Item
```http
POST https://api.podio.com/item/{item_id}/clone
Authorization: OAuth2 ACCESS_TOKEN
```

### Rearrange Item
Change item order in app.

```http
POST https://api.podio.com/item/{item_id}/rearrange
Authorization: OAuth2 ACCESS_TOKEN
Content-Type: application/json

{
  "before_item_id": 67890
}
```

### Export Items
```http
POST https://api.podio.com/item/app/{app_id}/export/{exporter}
Authorization: OAuth2 ACCESS_TOKEN
Content-Type: application/json

{
  "filters": {...}
}
```

Exporters: `xlsx`, `csv`

## Item Revisions

### Get Item Revisions
```http
GET https://api.podio.com/item/{item_id}/revision/
Authorization: OAuth2 ACCESS_TOKEN
```

**Response:**
```json
[
  {
    "revision": 3,
    "created_on": "2025-10-07 14:30:00",
    "created_by": {
      "user_id": 789,
      "name": "Jane Doe"
    },
    "type": "update"
  }
]
```

### Get Item Revision Difference
```http
GET https://api.podio.com/item/{item_id}/revision/{revision_from_id}/{revision_to_id}
Authorization: OAuth2 ACCESS_TOKEN
```

### Revert to Revision
```http
DELETE https://api.podio.com/item/{item_id}/revision/{revision_id}
Authorization: OAuth2 ACCESS_TOKEN
```

## Item References

### Get Item References
Get items that reference this item.

```http
GET https://api.podio.com/item/{item_id}/reference/
Authorization: OAuth2 ACCESS_TOKEN
```

### Delete Item Reference
```http
DELETE https://api.podio.com/item/{item_id}/reference/{reference_type}/{reference_id}
Authorization: OAuth2 ACCESS_TOKEN
```

## Item Field Values

### Get Item Field Values
```http
GET https://api.podio.com/item/{item_id}/value/{field_id}
Authorization: OAuth2 ACCESS_TOKEN
```

## Advanced Filtering

### Filter Options

**Field Filters:**
```json
{
  "filters": {
    "text-field": "search term",
    "number-field": {
      "from": 10,
      "to": 100
    },
    "date-field": {
      "from": "2025-01-01",
      "to": "2025-12-31"
    },
    "category-field": [1, 2],  // Option IDs
    "app-reference-field": [123, 456],  // Item IDs
    "contact-field": [789]  // User IDs
  }
}
```

**System Filters:**
```json
{
  "filters": {
    "created_on": {
      "from": "2025-01-01",
      "to": "2025-12-31"
    },
    "created_by": [123, 456],
    "tags": ["urgent", "client-project"]
  }
}
```

**Sorting:**
```json
{
  "sort_by": "field-external-id",
  "sort_desc": true
}
```

**Pagination:**
```json
{
  "limit": 30,
  "offset": 0
}
```

### Find Referenceable Items
Find items that can be referenced in an app reference field.

```http
POST https://api.podio.com/item/app/{app_id}/find_referenceable
Authorization: OAuth2 ACCESS_TOKEN
Content-Type: application/json

{
  "text": "search query",
  "limit": 10
}
```

## Use Cases for Workflow Migration

### 1. Get All Items from Source App
```javascript
async function getAllItems(appId, batchSize = 500) {
  const allItems = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const response = await apiClient.post(`/item/app/${appId}/filter/`, {
      limit: batchSize,
      offset: offset
    });

    allItems.push(...response.items);
    offset += batchSize;
    hasMore = response.filtered > offset;
  }

  return allItems;
}
```

### 2. Copy Items to Target App
```javascript
async function copyItems(sourceItems, targetAppId, fieldMapping) {
  const results = [];

  for (const sourceItem of sourceItems) {
    const mappedFields = {};

    // Map field values using field mapping
    sourceItem.fields.forEach(field => {
      const targetExternalId = fieldMapping[field.external_id];
      if (targetExternalId && field.values && field.values.length > 0) {
        mappedFields[targetExternalId] = field.values[0].value;
      }
    });

    const newItem = await apiClient.post(`/item/app/${targetAppId}/`, {
      fields: mappedFields,
      external_id: sourceItem.external_id
    });

    results.push(newItem);
  }

  return results;
}
```

### 3. Preserve External IDs
```javascript
async function copyItemWithExternalId(sourceItem, targetAppId, fieldMapping) {
  const fields = {};

  sourceItem.fields.forEach(field => {
    if (fieldMapping[field.external_id]) {
      fields[fieldMapping[field.external_id]] = extractFieldValue(field);
    }
  });

  return apiClient.post(`/item/app/${targetAppId}/`, {
    fields,
    external_id: sourceItem.external_id || `migrated-${sourceItem.item_id}`
  });
}

function extractFieldValue(field) {
  if (!field.values || field.values.length === 0) {
    return null;
  }

  const value = field.values[0];

  switch (field.type) {
    case 'text':
    case 'number':
      return value.value;
    case 'date':
      return { start: value.start, end: value.end };
    case 'category':
      return field.values.map(v => v.value.id);
    case 'app':
      return field.values.map(v => v.value.item_id);
    case 'contact':
      return field.values.map(v => v.value.profile_id || v.value.user_id);
    case 'money':
      return { value: value.value, currency: value.currency };
    case 'location':
      return value.value;
    default:
      return value.value;
  }
}
```

## Best Practices

1. **Use External IDs**: Set external_id for reliable item references
2. **Batch Operations**: Use filtering with pagination for large datasets
3. **Field Validation**: Validate field values match app field types
4. **Handle Relationships**: Map app references and contacts correctly
5. **Preserve Metadata**: Track created_on, created_by if needed
6. **Error Recovery**: Implement retry logic for failed item creation
7. **Rate Limiting**: Respect API rate limits with delays between requests

## Error Handling

### Common Errors

**400 Bad Request**: Invalid field value
```json
{
  "error": "invalid_request",
  "error_description": "Invalid value for field",
  "error_detail": "Field 'status' expects category option ID"
}
```

**404 Not Found**: Item or app doesn't exist
```json
{
  "error": "not_found",
  "error_description": "Item not found"
}
```

**409 Conflict**: External ID already exists
```json
{
  "error": "conflict",
  "error_description": "Item with external_id already exists"
}
```

## Example: Item Migrator

```javascript
class ItemMigrator {
  constructor(apiClient) {
    this.apiClient = apiClient;
  }

  async migrateItems(sourceAppId, targetAppId, fieldMapping) {
    // Get all source items
    const sourceItems = await this.getAllItems(sourceAppId);
    console.log(`Found ${sourceItems.length} items to migrate`);

    const results = {
      success: [],
      failed: []
    };

    for (const sourceItem of sourceItems) {
      try {
        const newItem = await this.copyItem(
          sourceItem,
          targetAppId,
          fieldMapping
        );
        results.success.push({ source: sourceItem.item_id, target: newItem.item_id });
      } catch (error) {
        results.failed.push({
          item_id: sourceItem.item_id,
          error: error.message
        });
      }
    }

    return results;
  }

  async getAllItems(appId) {
    const allItems = [];
    let offset = 0;
    const limit = 500;

    while (true) {
      const response = await this.apiClient.post(`/item/app/${appId}/filter/`, {
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

  async copyItem(sourceItem, targetAppId, fieldMapping) {
    const fields = this.mapFields(sourceItem, fieldMapping);

    return this.apiClient.post(`/item/app/${targetAppId}/`, {
      fields,
      external_id: sourceItem.external_id || `migrated-${sourceItem.item_id}`
    });
  }

  mapFields(sourceItem, fieldMapping) {
    const fields = {};

    sourceItem.fields.forEach(field => {
      const targetExternalId = fieldMapping[field.external_id];

      if (targetExternalId && field.values && field.values.length > 0) {
        fields[targetExternalId] = this.extractFieldValue(field);
      }
    });

    return fields;
  }

  extractFieldValue(field) {
    // See extractFieldValue function above
  }
}
```
