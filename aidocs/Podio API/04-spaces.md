# Spaces API

## Overview
A space (also called workspace) is a collaborative work area within an organization. Spaces contain applications, items, tasks, and other collaborative content.

## Hierarchy
```
Organization
  └── Space
      ├── Applications
      ├── Items
      ├── Tasks
      ├── Status Updates
      └── Members
```

## Key Endpoints

### Get Space
```http
GET https://api.podio.com/space/{space_id}
Authorization: OAuth2 ACCESS_TOKEN
```

**Response:**
```json
{
  "space_id": 67890,
  "name": "Marketing",
  "url": "marketing",
  "url_label": "marketing",
  "org_id": 12345,
  "role": "admin",
  "rights": ["view", "add_app", "add_item", "..."],
  "post_on_new_app": false,
  "post_on_new_member": false,
  "subscribed": true,
  "privacy": "closed",
  "auto_join": false,
  "type": "regular",
  "premium": true,
  "created_on": "2020-01-15 10:30:00",
  "org": {
    "org_id": 12345,
    "name": "Acme Corporation"
  }
}
```

### Get Space by URL
```http
GET https://api.podio.com/space/url?org_id={org_id}&space_url={space_url}
Authorization: OAuth2 ACCESS_TOKEN
```

**Example:**
```http
GET https://api.podio.com/space/url?org_id=12345&space_url=marketing
```

### Get Space by Organization and URL Label
```http
GET https://api.podio.com/space/org/{org_id}/{space_url_label}
Authorization: OAuth2 ACCESS_TOKEN
```

### Get Available Spaces
List all spaces accessible to the authenticated user.

```http
GET https://api.podio.com/space/
Authorization: OAuth2 ACCESS_TOKEN
```

### Get List of Organization Workspaces
```http
GET https://api.podio.com/space/org/{org_id}/
Authorization: OAuth2 ACCESS_TOKEN
```

**Response:**
```json
[
  {
    "space_id": 67890,
    "name": "Marketing",
    "url": "marketing",
    "org_id": 12345,
    "role": "admin"
  },
  {
    "space_id": 67891,
    "name": "Sales",
    "url": "sales",
    "org_id": 12345,
    "role": "regular"
  }
]
```

### Get Top Spaces
Most active or frequently accessed spaces.

```http
GET https://api.podio.com/space/top/
Authorization: OAuth2 ACCESS_TOKEN
```

## Space Management

### Create Space
```http
POST https://api.podio.com/space/
Authorization: OAuth2 ACCESS_TOKEN
Content-Type: application/json

{
  "org_id": 12345,
  "name": "New Workspace",
  "privacy": "closed",
  "auto_join": false,
  "post_on_new_app": false,
  "post_on_new_member": false
}
```

**Parameters:**
- `org_id` (required): Organization ID
- `name` (required): Space name
- `privacy`: "open" or "closed" (default: "closed")
- `auto_join`: Auto-add new org members (default: false)
- `post_on_new_app`: Post when apps created (default: false)
- `post_on_new_member`: Post when members added (default: false)

**Response:**
```json
{
  "space_id": 67892,
  "url": "new-workspace"
}
```

### Update Space
```http
PUT https://api.podio.com/space/{space_id}
Authorization: OAuth2 ACCESS_TOKEN
Content-Type: application/json

{
  "name": "Updated Name",
  "url_label": "new-url",
  "privacy": "open",
  "post_on_new_app": true
}
```

### Delete Space
Permanently delete a space and all its contents.

```http
DELETE https://api.podio.com/space/{space_id}
Authorization: OAuth2 ACCESS_TOKEN
```

⚠️ **Warning**: This is irreversible and deletes all apps, items, and content.

### Archive Space
Soft delete - space can be restored later.

```http
POST https://api.podio.com/space/{space_id}/archive
Authorization: OAuth2 ACCESS_TOKEN
```

### Restore Space
Restore an archived space.

```http
POST https://api.podio.com/space/{space_id}/restore
Authorization: OAuth2 ACCESS_TOKEN
```

## Space Settings

### Privacy Settings
- **open**: Anyone in organization can join
- **closed**: Invitation required

### Space Types
- **regular**: Standard workspace
- **demo**: Demo/test workspace
- **employee**: Employee-only workspace

## Space Members

### Space Roles
- **admin**: Full administrative control
- **regular**: Standard member access
- **light**: Limited access for external collaborators

### Space Rights
Common rights array values:
- `view`: Can view space
- `add_app`: Can create applications
- `add_item`: Can create items
- `add_task`: Can create tasks
- `add_space`: Can create sub-spaces
- `add_status`: Can post status updates
- `add_conversation`: Can start conversations
- `add_file`: Can upload files
- `grant`: Can manage members

## Available Seats

### Get Available Seats
Check available user seats in a space.

```http
GET https://api.podio.com/space/{space_id}/available_seats
Authorization: OAuth2 ACCESS_TOKEN
```

**Response:**
```json
{
  "regular": 25,
  "light": 100
}
```

## Use Cases for Workflow Migration

### 1. List Spaces in Source Organization
```javascript
const sourceSpaces = await apiClient.get(`/space/org/${sourceOrgId}/`);
console.log('Source spaces:', sourceSpaces.map(s => ({
  id: s.space_id,
  name: s.name,
  role: s.role
})));
```

### 2. Find or Create Target Space
```javascript
async function ensureTargetSpace(orgId, spaceName) {
  const spaces = await apiClient.get(`/space/org/${orgId}/`);
  const existing = spaces.find(s => s.name === spaceName);

  if (existing) {
    return existing;
  }

  // Create new space
  const newSpace = await apiClient.post('/space/', {
    org_id: orgId,
    name: spaceName,
    privacy: 'closed'
  });

  return newSpace;
}
```

### 3. Verify Space Access for Migration
```javascript
async function verifySpaceAccess(spaceId) {
  const space = await apiClient.get(`/space/${spaceId}`);

  if (space.role !== 'admin') {
    throw new Error(`Admin access required for space: ${space.name}`);
  }

  const hasRequiredRights = ['add_app', 'add_item'].every(
    right => space.rights.includes(right)
  );

  if (!hasRequiredRights) {
    throw new Error(`Insufficient permissions in space: ${space.name}`);
  }

  return space;
}
```

### 4. Clone Space Structure
```javascript
async function cloneSpaceSettings(sourceSpaceId, targetOrgId) {
  const sourceSpace = await apiClient.get(`/space/${sourceSpaceId}`);

  const targetSpace = await apiClient.post('/space/', {
    org_id: targetOrgId,
    name: `${sourceSpace.name} (Copy)`,
    privacy: sourceSpace.privacy,
    auto_join: sourceSpace.auto_join,
    post_on_new_app: sourceSpace.post_on_new_app,
    post_on_new_member: sourceSpace.post_on_new_member
  });

  return targetSpace;
}
```

## Best Practices

1. **Use URL Labels**: More stable than numeric IDs for references
2. **Check Role Before Operations**: Verify admin access for management tasks
3. **Archive Instead of Delete**: Use archive for reversible deletions
4. **Cache Space Metadata**: Space info changes infrequently
5. **Verify Rights**: Check specific rights array for fine-grained permissions
6. **Handle Privacy**: Respect privacy settings when migrating

## Error Handling

### Common Errors

**403 Forbidden**: Insufficient permissions
```json
{
  "error": "forbidden",
  "error_description": "User does not have required rights in space"
}
```

**404 Not Found**: Space doesn't exist or user has no access
```json
{
  "error": "not_found",
  "error_description": "Space not found"
}
```

**409 Conflict**: URL label already in use
```json
{
  "error": "conflict",
  "error_description": "URL label already exists in organization"
}
```

## Example: Space Migration Manager

```javascript
class SpaceMigrationManager {
  constructor(apiClient) {
    this.apiClient = apiClient;
  }

  async prepareSpaceMigration(sourceSpaceId, targetOrgId) {
    // Get source space details
    const sourceSpace = await this.apiClient.get(`/space/${sourceSpaceId}`);

    // Verify admin access
    if (sourceSpace.role !== 'admin') {
      throw new Error('Admin access required on source space');
    }

    // Check for existing space with same name in target
    const targetSpaces = await this.apiClient.get(`/space/org/${targetOrgId}/`);
    const existingTarget = targetSpaces.find(s => s.name === sourceSpace.name);

    if (existingTarget) {
      console.log(`Target space already exists: ${existingTarget.name}`);
      return { sourceSpace, targetSpace: existingTarget, isNew: false };
    }

    // Create new target space
    const targetSpace = await this.apiClient.post('/space/', {
      org_id: targetOrgId,
      name: sourceSpace.name,
      privacy: sourceSpace.privacy,
      auto_join: false,
      post_on_new_app: false,
      post_on_new_member: false
    });

    console.log(`Created target space: ${targetSpace.name}`);
    return { sourceSpace, targetSpace, isNew: true };
  }

  async getSpaceApps(spaceId) {
    return this.apiClient.get(`/app/space/${spaceId}/`);
  }
}
```
