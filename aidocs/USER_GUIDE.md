# Podio Migration Agent - User Guide

## Overview
The Podio Migration Agent is an AI-powered chat interface that helps you migrate large-scale Podio data between organizations. Built with GPT-5 and comprehensive Podio API tools, it specializes in migrating 80,000+ items with progress tracking, while also supporting workspace structure setup (apps, spaces, webhooks).

**Primary Use Case**: Large-scale item/data migration with batch processing and progress tracking
**Secondary Use Case**: Workspace structure migration (apps, spaces, webhooks)

**Note on Globiflow**: While the agent can discover Globiflow workflows, they cannot be migrated programmatically (no public API). Globiflow workflows must be manually recreated in target apps.

## Table of Contents
1. [Quick Start](#quick-start)
2. [Available Tools](#available-tools)
3. [Migration Workflows](#migration-workflows)
4. [Testing & Validation](#testing--validation)
5. [Migration Job Tracking](#migration-job-tracking)
6. [Troubleshooting](#troubleshooting)
7. [Best Practices](#best-practices)

---

## Quick Start

### Prerequisites
- Node.js 18+ installed
- Podio account with API access
- OpenAI API key (GPT-5 access)

### Setup

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd podio-agent
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment variables**

   Create `.env.local` file:
   ```env
   # OpenAI Configuration
   OPENAI_API_KEY=your_openai_api_key_here

   # Podio Configuration
   PODIO_CLIENT_ID=your_podio_client_id
   PODIO_CLIENT_SECRET=your_podio_client_secret
   PODIO_USERNAME=your_email@example.com
   PODIO_PASSWORD=your_podio_password
   ```

4. **Start the development server**
   ```bash
   npm run dev
   ```

5. **Open the chat interface**

   Navigate to `http://localhost:3000`

---

## Available Tools

The agent has access to specialized Podio tools organized by primary use case:

### Data Migration Tools (PRIMARY - Phase 5)

⚠️ **Coming Soon**: These tools are planned for Phase 5 implementation

**migrateItems**
- Batch migrate items between apps with field mapping
- Example: *"Migrate all 80,000 items from app 789 to app 202"*
- Features: Progress tracking, rate limit handling, retry logic

**exportItems**
- Export items to JSON/CSV for backup or transformation
- Example: *"Export all items from app 789 to JSON"*

**importItems**
- Import items from JSON/CSV with validation
- Example: *"Import items from backup.json into app 202"*

**getItemCount**
- Get total item count for migration planning
- Example: *"How many items are in app 789?"*

### Discovery Tools (6 tools)

**1. listOrganizations**
- Lists all Podio organizations you have access to
- Example: *"List my organizations"*

**2. listSpaces**
- Lists spaces within an organization
- Example: *"Show me spaces in organization 123"*

**3. getSpaceApps**
- Lists all apps in a space with metadata
- Example: *"What apps are in space 456?"*

**4. getAppStructure**
- Returns detailed app structure including all fields
- Example: *"Show me the structure of app 789"*

**5. getAppFlows**
- Lists all Globiflow flows for an app
- Example: *"What flows does app 789 have?"*

**6. getAppHooks**
- Lists all webhooks for an app
- Example: *"Show me hooks for app 789"*

### Structure Migration Tools (SECONDARY - 5 tools)

**7. createSpace**
- Creates a new space in target organization
- Example: *"Create a space called 'Marketing Copy' in org 123"*

**8. cloneApp**
- Clones an app from source to target space
- Example: *"Clone app 789 to space 456"*

**9. getAppFlows**
- Lists Globiflow workflows for an app (read-only)
- Example: *"What Globiflow workflows does app 789 have?"*
- Note: ⚠️ Globiflow workflows cannot be cloned via API - manual recreation required

**10. cloneHook**
- Clones a webhook to a target app
- Example: *"Clone hook 600 to app 202"*

**11. updateAppReferences**
- Updates cross-app reference fields after migration
- Example: *"Update app references in app 202"*

### Validation Tools (3 tools)

**12. validateAppStructure**
- Compares source and target app structures
- Example: *"Validate that app 202 matches app 789"*

**13. testFlow**
- Creates a test item to trigger flow execution
- Example: *"Test flow 700 in app 202"*

**14. getMigrationStatus**
- Retrieves migration job progress and status
- Example: *"What's the status of migration abc-123?"*

---

## Migration Workflows

### Large-Scale Data Migration (PRIMARY - Coming in Phase 5)

**Migrating 80,000+ Items**
```
You: "I need to migrate 80,000 items from app 789 to app 202"

Agent:
1. Gets item count from app 789 (80,523 items)
2. Validates field mapping between apps
3. Tests sample batch (first 100 items)
4. Confirms migration with user
5. Migrates in batches of 500 items
6. Shows real-time progress:
   - Progress: 45% (36,000/80,523 items)
   - Speed: 4.2 items/sec
   - ETA: 3 hours 15 minutes
7. Handles rate limits automatically
8. Retries failed items
9. Returns migration summary with stats
```

**Export/Import Workflow**
```
You: "Export all items from app 789 to JSON, then import to app 202"

Agent:
1. Exports 80,523 items to backup.json (streaming)
2. Validates JSON structure
3. Imports items to app 202 with progress tracking
4. Returns import summary
```

### Structure-Only Migration (SECONDARY)

**Simple App Migration**
```
You: "Clone app 789 to space 200"

Agent:
1. Gets structure of app 789
2. Clones app to space 200
3. Validates structure matches
4. Returns new app ID and field mapping
```

**Complete Workspace Migration**
```
You: "Migrate all apps from space 100 to a new space in org 2"

Agent:
1. Creates new space in org 2
2. Lists all apps in space 100
3. Clones each app sequentially
4. Updates cross-app references
5. Validates all app structures
6. Returns migration summary
```

**Migration with Webhooks**
```
You: "Clone app 789 to space 200 with all its hooks"

Agent:
1. Clones app 789 to space 200
2. Lists all hooks for app 789
3. Clones each hook
4. Returns migration summary
```

---

## Testing & Validation

### Flow Testing

The `testFlow` tool creates a test item in the app to trigger flow execution:

```
You: "Test flow 700 in app 202"

Agent Response:
- Flow ID: 700
- Test Item Created: ID 12345
- Flow Status: Active
- Execution: Triggered (verification requires manual check or webhook)
```

**Note**: Full flow execution verification requires Globiflow API access or webhook monitoring. The tool confirms:
- ✅ Flow exists
- ✅ Flow is active
- ✅ Test item created successfully
- ⚠️ Flow execution must be verified manually or via webhooks

### Structure Validation

Compare source and target app structures:

```
You: "Validate app 202 against app 789 in strict mode"

Agent Response:
- Matched Fields: 15
- Missing Fields: 0
- Type Mismatches: 0
- Config Differences: 2 (warnings)
```

---

## Migration Job Tracking

### State Persistence

All migrations are tracked using a file-based state store in `data/migrations/`.

### Checking Migration Status

```
You: "What's the status of migration abc-123?"

Agent Response:
- Migration ID: abc-123
- Status: in_progress
- Progress: 60% (6/10 steps completed)
- Apps Cloned: 3
- Flows Cloned: 2
- Hooks Cloned: 1
- Errors: 0
```

### Migration Job Lifecycle

1. **Planning** - Initial job created, analyzing dependencies
2. **In Progress** - Actively cloning resources
3. **Completed** - All steps successful
4. **Failed** - One or more steps failed (see errors)

---

## Troubleshooting

### Common Issues

**1. Authentication Errors**
```
Error: Invalid credentials
```
**Solution**: Verify Podio credentials in `.env.local`

**2. Permission Errors**
```
Error: Insufficient permissions to access organization
```
**Solution**: Ensure your Podio account has admin access to source and target workspaces

**3. App Not Found**
```
Error: App 789 not found
```
**Solution**: Verify app ID is correct and you have access

**4. Rate Limiting**
```
Error: Rate limit exceeded
```
**Solution**: The agent automatically retries with exponential backoff. Wait a few minutes.

**5. Field Reference Errors**
```
Warning: Unresolved app references in field "Related Items"
```
**Solution**: Clone all related apps first, then update references with `updateAppReferences`

### Debugging

**Enable Debug Logging**:
Check the terminal running `npm run dev` for detailed logs:
- Tool calls with arguments
- Tool results (preview)
- Usage metrics (token counts)
- Timing information

**Check Migration State**:
Migration jobs are stored in `data/migrations/{job-id}.json`

---

## Best Practices

### 1. Discovery First
Always start by discovering your source workspace structure:
```
"List all apps in space 100 with their flows and hooks"
```

### 2. Clone in Order
Follow this sequence:
1. Create target space (if needed)
2. Clone apps (no flows/hooks yet)
3. Update app references
4. Clone flows
5. Clone hooks
6. Test flows

### 3. Validate Early
Validate app structures immediately after cloning:
```
"Clone app 789 to space 200, then validate the structure"
```

### 4. Handle App References
Apps with relationship fields need reference updates:
```
"Clone apps 100, 101, 102 to space 200, then update all app references"
```

### 5. Test Flows
Always test flows after migration:
```
"Test all flows in app 202"
```

### 6. Keep Track of IDs
The agent provides mapping tables:
```
Source App 789 → Target App 202
Source Flow 500 → Target Flow 700
```

### 7. Backup First
Before any migration, ensure you have backups of your Podio data.

### 8. Start Small
Test migrations with a single simple app before migrating entire workspaces.

---

## Example Session

```
You: "Hi! I need to migrate my Marketing workspace to a new organization."

Agent: "I can help you with that! Let me start by discovering your current workspace structure.
What's the space ID or name of your Marketing workspace?"

You: "It's space 100 in organization 1"

Agent: [Calls getSpaceApps]
"I found 5 apps in your Marketing space:
1. Campaigns (ID: 201) - 3 flows, 1 hook
2. Leads (ID: 202) - 2 flows, 0 hooks
3. Analytics (ID: 203) - 1 flow, 0 hooks
4. Budget (ID: 204) - 0 flows, 0 hooks
5. Contacts (ID: 205) - 1 flow, 2 hooks

I notice the Campaigns app references the Leads app.
Would you like me to migrate all of these to a new space in organization 2?"

You: "Yes, please migrate everything"

Agent: [Executes migration workflow]
1. Creates new space "Marketing Copy" in org 2
2. Clones all 5 apps
3. Updates app references (Campaigns → Leads)
4. Clones all 7 flows
5. Clones all 3 hooks
6. Validates all structures

"Migration complete! Here's your mapping:
- New Space: 300
- Campaigns: 201 → 301
- Leads: 202 → 302
- Analytics: 203 → 303
- Budget: 204 → 304
- Contacts: 205 → 305

All flows and hooks have been migrated and tested successfully."
```

---

## Advanced Features

### Field Remapping
Flows automatically remap field references when cloned to preserve functionality.

### Atomic Writes
Migration state uses atomic file writes to prevent data corruption.

### Error Recovery
Failed migrations can be resumed using the migration job ID.

### Telemetry
All operations are logged with timing metrics for performance monitoring.

---

## Known Limitations

⚠️ **Data Migration Tools Not Yet Implemented**
- migrateItems, exportItems, importItems planned for Phase 5
- Currently supports structure migration only (apps, spaces, webhooks)

⚠️ **Globiflow Workflows Cannot Be Migrated**
- Globiflow has no public API
- Workflows must be manually recreated in target apps
- Agent provides field mapping guidance for manual recreation

⚠️ **File Attachments**
- File migration requires separate download/upload workflow
- Not included in standard item migration
- Plan for additional time when migrating items with files

⚠️ **Resume/Restart Capability**
- Planned for Phase 5 data migrations
- Currently no automatic resume for interrupted migrations

⚠️ **Rollback**
- No automatic rollback mechanism
- Manual cleanup required if migration fails partway
- Always validate with sample batch before full migration

⚠️ **Scale Considerations**
- File-based state store suitable for most use cases
- Very large migrations (500+ apps or 100K+ items) may need optimization
- Monitor memory usage for migrations > 50K items

---

## Support

For issues or questions:
1. Check this guide first
2. Review terminal logs for detailed error messages
3. Check migration state files in `data/migrations/`
4. Create an issue on GitHub with:
   - Error message
   - Steps to reproduce
   - Migration job ID (if applicable)

---

## Next Steps

**Current Status**: Phase 4 Complete

**Upcoming** (Phase 5 - Data Migration Implementation):
- Large-scale item migration tools (80,000+ items)
- Batch processing with progress tracking
- Export/import capabilities (JSON/CSV)
- Resume/restart functionality
- Memory-optimized streaming for large datasets

**Future** (Phase 6 - Documentation & Polish):
- Comprehensive testing and optimization
- Performance benchmarking
- Enhanced error handling
- User feedback integration

---

**Version**: 1.5.0 (Phase 4 Complete - Refocused on Data Migration)
**Last Updated**: 2025-10-08
