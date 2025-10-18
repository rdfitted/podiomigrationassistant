# Organizations API

## Overview
An organization is the top-level container in Podio's hierarchy. Organizations contain spaces (workspaces), users, and manage billing.

## Hierarchy
```
Organization
  ├── Spaces (Workspaces)
  ├── Members
  └── Billing/Settings
```

## Key Endpoints

### Get Organizations
Retrieve all organizations the authenticated user has access to.

```http
GET https://api.podio.com/org/
Authorization: OAuth2 ACCESS_TOKEN
```

**Response:**
```json
[
  {
    "org_id": 123456,
    "name": "Acme Corporation",
    "logo": "...",
    "url": "acme",
    "url_label": "acme",
    "premium": true,
    "role": "admin",
    "status": "active",
    "sales_agent_id": null,
    "created_on": "2020-01-15 10:30:00",
    "user_limit": 50,
    "member_count": 25
  }
]
```

### Get Organization by ID
```http
GET https://api.podio.com/org/{org_id}
Authorization: OAuth2 ACCESS_TOKEN
```

### Get Organization by URL
```http
GET https://api.podio.com/org/url?org_url={org_url}
Authorization: OAuth2 ACCESS_TOKEN
```

**Example:**
```http
GET https://api.podio.com/org/url?org_url=acme
```

### Get Shared Organizations
Organizations shared between authenticated user and another user.

```http
GET https://api.podio.com/org/shared/{user_id}
Authorization: OAuth2 ACCESS_TOKEN
```

## Organization Management

### Create Organization
```http
POST https://api.podio.com/org/
Authorization: OAuth2 ACCESS_TOKEN
Content-Type: application/json

{
  "name": "New Organization"
}
```

### Update Organization
```http
PUT https://api.podio.com/org/{org_id}
Authorization: OAuth2 ACCESS_TOKEN
Content-Type: application/json

{
  "name": "Updated Name",
  "logo": "...",
  "url_label": "new-url"
}
```

## Members & Roles

### Get Organization Members
```http
GET https://api.podio.com/org/{org_id}/member/
Authorization: OAuth2 ACCESS_TOKEN
```

**Response:**
```json
[
  {
    "user": {
      "user_id": 12345,
      "name": "John Doe",
      "mail": "john@example.com",
      "avatar": "..."
    },
    "role": "admin",
    "employee": true,
    "grants_count": 5,
    "spaces": [
      {
        "space_id": 67890,
        "name": "Marketing"
      }
    ]
  }
]
```

### Get Organization Admins
```http
GET https://api.podio.com/org/{org_id}/admin/
Authorization: OAuth2 ACCESS_TOKEN
```

### Get Organization Member
Get specific member details.

```http
GET https://api.podio.com/org/{org_id}/member/{user_id}
Authorization: OAuth2 ACCESS_TOKEN
```

### Search Organization Members
```http
GET https://api.podio.com/org/{org_id}/member/search?query={search_query}
Authorization: OAuth2 ACCESS_TOKEN
```

### End Organization Membership
Remove a member from the organization.

```http
DELETE https://api.podio.com/org/{org_id}/member/{user_id}
Authorization: OAuth2 ACCESS_TOKEN
```

### Delete Organization Member Role
```http
DELETE https://api.podio.com/org/{org_id}/member/{user_id}/role
Authorization: OAuth2 ACCESS_TOKEN
```

## Organization Spaces

### Get All Spaces in Organization
```http
GET https://api.podio.com/org/{org_id}/space/
Authorization: OAuth2 ACCESS_TOKEN
```

### Get Space Memberships for Org Member
```http
GET https://api.podio.com/org/{org_id}/member/{user_id}/space/
Authorization: OAuth2 ACCESS_TOKEN
```

## Reports & Analytics

### Get Organization Login Report
Track user login activity.

```http
GET https://api.podio.com/org/{org_id}/report/login/
Authorization: OAuth2 ACCESS_TOKEN
```

## App Store Profile

### Create Organization App Store Profile
```http
POST https://api.podio.com/org/{org_id}/appstore/profile/
Authorization: OAuth2 ACCESS_TOKEN
Content-Type: application/json

{
  "name": "App Store Name",
  "description": "Description",
  "website": "https://example.com"
}
```

### Update Organization App Store Profile
```http
PUT https://api.podio.com/org/{org_id}/appstore/profile/
Authorization: OAuth2 ACCESS_TOKEN
Content-Type: application/json
```

### Delete Organization App Store Profile
```http
DELETE https://api.podio.com/org/{org_id}/appstore/profile/
Authorization: OAuth2 ACCESS_TOKEN
```

## Organization Roles

### Role Types
- **admin**: Full administrative access
- **regular**: Standard member access
- **light**: Limited access (typically for external collaborators)

### Role Permissions
Admins can:
- Manage organization settings
- Add/remove members
- Create/delete spaces
- Manage billing
- View all organization data

## Use Cases for Workflow Migration

### 1. List All Organizations
Identify source and target organizations for workflow migration.

```javascript
const organizations = await getOrganizations();
console.log('Available organizations:', organizations.map(o => o.name));
```

### 2. Verify Organization Access
Ensure authenticated user has admin access to both source and target.

```javascript
const org = await getOrganization(orgId);
if (org.role !== 'admin') {
  throw new Error('Admin access required for workflow migration');
}
```

### 3. Get Organization Spaces
List all workspaces to identify which contain workflows to migrate.

```javascript
const spaces = await getOrganizationSpaces(sourceOrgId);
console.log('Spaces with apps:', spaces.map(s => s.name));
```

## Best Practices

1. **Cache Organization Data**: Organization structure changes infrequently
2. **Verify Permissions**: Always check role before attempting admin operations
3. **Use URL Labels**: More stable than numeric IDs for references
4. **Handle Rate Limits**: Implement exponential backoff for bulk operations
5. **Audit Trail**: Log organization-level changes for compliance

## Error Handling

### Common Errors

**403 Forbidden**: Insufficient permissions
```json
{
  "error": "forbidden",
  "error_description": "User does not have required role",
  "error_detail": "Admin access required"
}
```

**404 Not Found**: Organization doesn't exist or user has no access
```json
{
  "error": "not_found",
  "error_description": "Organization not found"
}
```

## Example: Organization Migration Context

```javascript
class OrganizationContext {
  constructor(apiClient) {
    this.apiClient = apiClient;
  }

  async getSourceAndTargetOrgs(sourceOrgId, targetOrgId) {
    const [source, target] = await Promise.all([
      this.apiClient.get(`/org/${sourceOrgId}`),
      this.apiClient.get(`/org/${targetOrgId}`)
    ]);

    // Verify admin access
    if (source.role !== 'admin' || target.role !== 'admin') {
      throw new Error('Admin access required on both organizations');
    }

    return { source, target };
  }

  async getMigrationContext(sourceOrgId, targetOrgId) {
    const { source, target } = await this.getSourceAndTargetOrgs(
      sourceOrgId,
      targetOrgId
    );

    const [sourceSpaces, targetSpaces] = await Promise.all([
      this.apiClient.get(`/org/${sourceOrgId}/space/`),
      this.apiClient.get(`/org/${targetOrgId}/space/`)
    ]);

    return {
      source: { org: source, spaces: sourceSpaces },
      target: { org: target, spaces: targetSpaces }
    };
  }
}
```
