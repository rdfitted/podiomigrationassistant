# Hooks API (Webhooks)

## Overview
Hooks (webhooks) allow external systems to receive real-time notifications when events occur in Podio. They are essential for integrating Podio with third-party services and extending automation beyond Podio's native Flows.

## Hook Structure
```
Hook
  ├── Reference (App or Space)
  ├── Event Type (item.create, task.update, etc.)
  ├── Webhook URL
  └── Verification Status
```

## Key Concepts

### Reference Types
- **app**: Hooks on application-level events (items, comments, files)
- **app_field**: Hooks on specific field changes
- **space**: Hooks on space-level events (apps, tasks, members)
- **hook**: Hooks on webhook verification

### Hook Lifecycle
1. **Create**: Hook created but unverified
2. **Verify**: Podio sends verification request to URL
3. **Respond**: Your endpoint responds with verification code
4. **Active**: Hook verified and active
5. **Failed**: Too many failures deactivates hook

## Endpoints

### Create Hook
```http
POST https://api.podio.com/hook/{ref_type}/{ref_id}/
Authorization: OAuth2 ACCESS_TOKEN
Content-Type: application/json

{
  "url": "https://example.com/webhook",
  "type": "item.create"
}
```

**Parameters:**
- `ref_type`: "app", "app_field", "space", or "hook"
- `ref_id`: ID of the reference (app_id, field_id, space_id)
- `url`: Your webhook endpoint URL
- `type`: Event type (see Event Types below)

**Response:**
```json
{
  "hook_id": 123,
  "status": "inactive",
  "type": "item.create",
  "url": "https://example.com/webhook"
}
```

### Get Hooks
```http
GET https://api.podio.com/hook/{ref_type}/{ref_id}/
Authorization: OAuth2 ACCESS_TOKEN
```

**Response:**
```json
[
  {
    "hook_id": 123,
    "status": "active",
    "type": "item.create",
    "url": "https://example.com/webhook",
    "created_on": "2025-01-15 10:30:00"
  }
]
```

### Delete Hook
```http
DELETE https://api.podio.com/hook/{hook_id}
Authorization: OAuth2 ACCESS_TOKEN
```

### Request Hook Verification
Manually request verification (Podio also auto-sends on creation).

```http
POST https://api.podio.com/hook/{hook_id}/verify/request
Authorization: OAuth2 ACCESS_TOKEN
```

### Validate Hook Verification
Verify the hook with the code received at your webhook.

```http
POST https://api.podio.com/hook/{hook_id}/verify/validate
Authorization: OAuth2 ACCESS_TOKEN
Content-Type: application/json

{
  "code": "VERIFICATION_CODE_FROM_WEBHOOK"
}
```

## Event Types

### App-Level Events (ref_type: "app")

**Item Events:**
- `item.create`: New item created
- `item.update`: Item updated
- `item.delete`: Item deleted

**Comment Events:**
- `comment.create`: Comment added to item
- `comment.delete`: Comment deleted

**File Events:**
- `file.change`: File attached, updated, or removed

**App Events:**
- `app.update`: App structure/config changed
- `app.delete`: App deleted

**Form Events:**
- `form.create`: Web form created
- `form.update`: Web form updated
- `form.delete`: Web form deleted

**Tag Events:**
- `tag.add`: Tag added to item
- `tag.delete`: Tag removed from item

### Space-Level Events (ref_type: "space")

**App Events:**
- `app.create`: New app created in space

**Task Events:**
- `task.create`: Task created
- `task.update`: Task updated
- `task.delete`: Task deleted

**Member Events:**
- `member.add`: Member added to space
- `member.remove`: Member removed from space

**Status Events:**
- `status.create`: Status update posted
- `status.update`: Status update edited
- `status.delete`: Status update deleted

### Field-Level Events (ref_type: "app_field")
- `item.update`: Triggered only when specific field is updated

### Hook Events (ref_type: "hook")
- `hook.verify`: Verification request

## Webhook Verification

### Verification Flow

1. **Create Hook**: POST to create hook endpoint
2. **Receive Verification**: Podio sends POST to your webhook URL:
```json
{
  "type": "hook.verify",
  "hook_id": 123,
  "code": "VERIFICATION_CODE"
}
```

3. **Respond Immediately**: Return 200 OK within 10 seconds
4. **Validate**: Call validate endpoint with code
5. **Hook Activated**: Hook status changes to "active"

### Verification Example (Node.js/Express)

```javascript
app.post('/webhook', (req, res) => {
  const { type, hook_id, code } = req.body;

  if (type === 'hook.verify') {
    // Respond immediately
    res.status(200).send('OK');

    // Validate in background
    validateHook(hook_id, code);
  } else {
    // Handle other events
    handlePodioEvent(req.body);
    res.status(200).send('OK');
  }
});

async function validateHook(hookId, code) {
  await apiClient.post(`/hook/${hookId}/verify/validate`, { code });
  console.log(`Hook ${hookId} verified`);
}
```

## Webhook Payload

### Standard Payload Structure
```json
{
  "type": "item.create",
  "item_id": 12345,
  "app_id": 54321,
  "space_id": 67890,
  "created_on": "2025-10-07 14:30:00",
  "created_by": 789,
  "hook_id": 123
}
```

### item.create / item.update
```json
{
  "type": "item.create",
  "item_id": 12345,
  "app_id": 54321,
  "space_id": 67890,
  "created_on": "2025-10-07 14:30:00",
  "created_by": 789,
  "hook_id": 123
}
```

### item.delete
```json
{
  "type": "item.delete",
  "item_id": 12345,
  "app_id": 54321,
  "deleted_on": "2025-10-07 14:30:00",
  "deleted_by": 789,
  "hook_id": 123
}
```

### comment.create
```json
{
  "type": "comment.create",
  "comment_id": 98765,
  "item_id": 12345,
  "app_id": 54321,
  "created_on": "2025-10-07 14:30:00",
  "created_by": 789,
  "hook_id": 123
}
```

### task.create / task.update
```json
{
  "type": "task.create",
  "task_id": 11111,
  "space_id": 67890,
  "created_on": "2025-10-07 14:30:00",
  "created_by": 789,
  "hook_id": 123
}
```

## Hook Requirements

### URL Requirements
- Must be HTTPS (HTTP not supported)
- Only ports 80 and 443 allowed
- Must respond with 2xx status code within 10 seconds
- Must be publicly accessible

### Performance Requirements
- Respond quickly (< 10 seconds)
- Process asynchronously if needed
- Queue webhook processing for reliability

### Failure Handling
- 50 consecutive failures → hook deactivated
- Slow responses (> 10s timeout) count as failures
- Monitor hook status regularly

## Use Cases for Workflow Migration

### 1. Get All Hooks from Source App
```javascript
async function getAppHooks(appId) {
  const hooks = await apiClient.get(`/hook/app/${appId}/`);
  console.log(`Found ${hooks.length} hooks in app ${appId}`);
  return hooks;
}
```

### 2. Clone Hook to Target App
```javascript
async function cloneHook(sourceHook, targetAppId) {
  // Create hook with same configuration
  const newHook = await apiClient.post(`/hook/app/${targetAppId}/`, {
    url: sourceHook.url,
    type: sourceHook.type
  });

  console.log(`Created hook ${newHook.hook_id}, awaiting verification`);

  return newHook;
}
```

### 3. Migrate All Hooks for App
```javascript
async function migrateAppHooks(sourceAppId, targetAppId) {
  const sourceHooks = await apiClient.get(`/hook/app/${sourceAppId}/`);

  const results = [];

  for (const hook of sourceHooks) {
    // Only migrate active hooks
    if (hook.status !== 'active') {
      continue;
    }

    try {
      const newHook = await apiClient.post(`/hook/app/${targetAppId}/`, {
        url: hook.url,
        type: hook.type
      });

      results.push({
        success: true,
        source: hook.hook_id,
        target: newHook.hook_id,
        type: hook.type,
        url: hook.url,
        needsVerification: true
      });
    } catch (error) {
      results.push({
        success: false,
        source: hook.hook_id,
        type: hook.type,
        error: error.message
      });
    }
  }

  return results;
}
```

### 4. Update Webhook URLs
If migrating to a different webhook endpoint:

```javascript
async function updateHookUrls(hooks, oldUrl, newUrl) {
  for (const hook of hooks) {
    if (hook.url === oldUrl) {
      // Delete old hook
      await apiClient.delete(`/hook/${hook.hook_id}`);

      // Create new hook with updated URL
      await apiClient.post(`/hook/${hook.ref_type}/${hook.ref_id}/`, {
        url: newUrl,
        type: hook.type
      });
    }
  }
}
```

## Best Practices

1. **Idempotency**: Handle duplicate webhook calls gracefully
2. **Quick Response**: Return 200 immediately, process asynchronously
3. **Error Handling**: Log errors, don't let exceptions fail the response
4. **Validation**: Verify webhook authenticity (check hook_id exists)
5. **Retries**: Implement retry logic for processing failures
6. **Monitoring**: Track hook failures and deactivations
7. **Security**: Validate requests from Podio's IP ranges
8. **Rate Limiting**: Handle burst of webhooks during bulk operations

### Example Webhook Handler

```javascript
class PodioWebhookHandler {
  constructor(apiClient, queue) {
    this.apiClient = apiClient;
    this.queue = queue;
  }

  async handleWebhook(payload) {
    const { type, hook_id } = payload;

    // Handle verification
    if (type === 'hook.verify') {
      await this.verifyHook(hook_id, payload.code);
      return;
    }

    // Queue for async processing
    await this.queue.add('podio-webhook', payload);
  }

  async verifyHook(hookId, code) {
    await this.apiClient.post(`/hook/${hookId}/verify/validate`, { code });
    console.log(`Hook ${hookId} verified successfully`);
  }

  async processWebhook(payload) {
    const { type, item_id, app_id } = payload;

    switch (type) {
      case 'item.create':
        await this.onItemCreate(item_id, app_id);
        break;

      case 'item.update':
        await this.onItemUpdate(item_id, app_id);
        break;

      case 'item.delete':
        await this.onItemDelete(item_id, app_id);
        break;

      default:
        console.log(`Unhandled webhook type: ${type}`);
    }
  }

  async onItemCreate(itemId, appId) {
    // Fetch full item details
    const item = await this.apiClient.get(`/item/${itemId}`);

    // Process item creation
    console.log(`New item created: ${item.title}`);
  }

  async onItemUpdate(itemId, appId) {
    const item = await this.apiClient.get(`/item/${itemId}`);
    console.log(`Item updated: ${item.title}`);
  }

  async onItemDelete(itemId, appId) {
    console.log(`Item deleted: ${itemId}`);
  }
}
```

## Error Handling

### Common Errors

**400 Bad Request**: Invalid URL or event type
```json
{
  "error": "invalid_request",
  "error_description": "Invalid webhook URL",
  "error_detail": "URL must use HTTPS and port 443"
}
```

**404 Not Found**: App or space not found
```json
{
  "error": "not_found",
  "error_description": "App not found"
}
```

**410 Gone**: Hook deactivated due to failures
```json
{
  "error": "gone",
  "error_description": "Hook has been deactivated due to too many failures"
}
```

## Hook Migration Checklist

- [ ] List all hooks from source app
- [ ] Verify webhook URLs are accessible
- [ ] Create hooks in target app
- [ ] Handle verification requests
- [ ] Validate all hooks
- [ ] Test webhook delivery
- [ ] Monitor for failures
- [ ] Document webhook endpoints
- [ ] Update webhook handler to recognize new hook_ids

## Comparison: Flows vs Hooks

| Feature | Flows | Hooks |
|---------|-------|-------|
| **Scope** | Internal Podio only | External integrations |
| **Latency** | Immediate | Near real-time (< 1s) |
| **Actions** | Limited built-in effects | Unlimited custom logic |
| **Setup** | No coding required | Requires endpoint development |
| **Reliability** | Very high | Depends on endpoint reliability |
| **Use Case** | Simple automation | Complex workflows, external systems |
| **Verification** | None | Required |

## Example: Hook Migrator

```javascript
class HookMigrator {
  constructor(apiClient) {
    this.apiClient = apiClient;
  }

  async migrateHooks(sourceAppId, targetAppId) {
    // Get all hooks from source
    const sourceHooks = await this.apiClient.get(`/hook/app/${sourceAppId}/`);

    console.log(`Found ${sourceHooks.length} hooks to migrate`);

    const results = {
      success: [],
      failed: [],
      needsVerification: []
    };

    for (const hook of sourceHooks) {
      // Skip inactive hooks
      if (hook.status !== 'active') {
        console.log(`Skipping inactive hook: ${hook.hook_id}`);
        continue;
      }

      try {
        const newHook = await this.apiClient.post(`/hook/app/${targetAppId}/`, {
          url: hook.url,
          type: hook.type
        });

        results.success.push({
          sourceId: hook.hook_id,
          targetId: newHook.hook_id,
          type: hook.type,
          url: hook.url
        });

        results.needsVerification.push(newHook.hook_id);

        console.log(`✓ Created hook: ${hook.type} -> ${hook.url}`);
        console.log(`  Verification needed for hook ${newHook.hook_id}`);
      } catch (error) {
        results.failed.push({
          sourceId: hook.hook_id,
          type: hook.type,
          url: hook.url,
          error: error.message
        });

        console.error(`✗ Failed to create hook: ${hook.type}`, error.message);
      }
    }

    return results;
  }
}
```
