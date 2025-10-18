# Globiflow (Podio Workflow Automation)

## Overview

**Globiflow**, now branded as **Podio Workflow Automation**, is an advanced automation platform integrated into Podio Premium organizations. It is fundamentally different from Podio's native flows API and provides significantly more sophisticated automation capabilities.

### Important Distinction

- **Podio Native Flows** (documented in `07-flows.md`): Simple API-based workflows with basic triggers and effects via `/flow/` endpoints
- **Globiflow/Workflow Automation**: Advanced automation system with collectors, logic operations, complex conditions, and 24+ action types

Globiflow is the enterprise-grade automation layer that most Podio users rely on for complex business process automation.

## Access and Permissions

- Available exclusively on **Podio Premium** organizations
- Initial access granted to **contract owner** only
- Additional users can be granted access via "Additional Users" section on Account page
- Users with access can add/edit flows in any workspace where they are listed as an **administrator**

## Core Architecture

Globiflow workflows are built using three fundamental components:

### 1. Triggers (Flow Initiation)

Globiflow offers **11 trigger types** that initiate automated workflows:

#### Time-Based Triggers
- **By Day or Date**: Execute on specific dates or days without Podio data context

#### Item-Related Triggers
- **Item Created**: Activates when new items are added to an app
- **Item Updated**: Fires when existing items are modified
- **New Comment**: Triggers upon comment addition to items
- **Date Field**: Activates when date field conditions are met

#### Task & Communication Triggers
- **Task Completion**: Fires when automation-generated tasks are marked complete
- **Email Reply**: Activates when responses arrive to flow-sent emails
- **SMS Text Reply**: Triggers on replies to flow-sent text messages

#### External Integration Triggers
- **Manual Flow**: Set up for triggering within other flows
- **External Link**: Activates via special external link clicks
- **RightSignature Document Signed**: Fires when documents are signed

### 2. Collectors (Data Retrieval)

Collectors retrieve data from Podio to use in workflow logic and actions:

1. **Get Previous Revision**: Access earlier versions of item fields
2. **Get Items Task(s)**: Retrieve all open tasks associated with an item
3. **Get Referenced Item(s)**: Pull fields from items in other apps
4. **Search for Item(s)**: Locate items within current or different apps
5. **Get Podio View**: Extract items from team views

### 3. Logic (Data Manipulation)

Logic components process collected data through **9 operations**:

- **Sort Collected**: Organize retrieved items by field values
- **Clear Collected Items**: Remove previously found items from memory
- **Custom Variable/Calc**: Create calculated variables from fields using PHP expressions
- **If (Sanity Check)**: Establish conditional statements in PHP notation
- **End If**: Close conditional blocks
- **Detail Table**: Generate HTML tables from collected items
- **For Each**: Repeat actions across multiple items (loop structure)
- **Continue**: Exit loops early and resume standard execution
- **Wait (Delay)**: Pause workflows for 30 seconds

### 4. Actions (Workflow Execution)

The system includes **24+ action types** spanning multiple categories:

#### Communication Actions
- Send messages
- Send emails
- Send SMS

#### Data Management Actions
- Create new items
- Update existing items
- Delete items
- Update field values
- Add/remove tags

#### Document Actions
- Generate PDFs
- Create Excel sheets
- Generate documents from templates

#### Integration Actions
- Remote POST/GET (call external APIs)
- Webhook triggers
- ShareFile integration
- RightSignature integration

#### Advanced Actions
- Trigger other flows
- Create tasks
- Add comments
- Post status updates
- Web embedding

## Action Limits and Usage

- Each step in a flow has an associated cost: `(a=1)` indicates 1 action
- Actions count toward **monthly** and **hourly** limits based on plan
- Flows process **synchronously**, executing each step in order
- API usage restrictions apply (Podio restricts API calls)

## The Flow Tree Structure

Globiflow workflows are organized in a tree structure:
```
Flow
├── Trigger (e.g., Item Created)
├── Filters (Conditional logic)
├── Collectors (Data gathering)
│   ├── Get Referenced Items
│   └── Search for Items
├── Logic (Data processing)
│   ├── Custom Variables
│   ├── If/Then conditions
│   └── For Each loops
└── Actions (Execute operations)
    ├── Create Item
    ├── Send Email
    └── Remote POST
```

## Hook Events

Globiflow uses "hook events" to respond to Podio activities. These are similar to webhooks but managed internally within the Globiflow system.

## Key Features

### Custom Variables and PHP Calculations

Globiflow supports PHP expressions for advanced calculations:
- Field value manipulation
- Date/time calculations
- String operations
- Mathematical expressions
- Conditional logic

### Filters and Conditional Logic

Apply complex filters using:
- Logical operators (AND, OR, NOT)
- Field value comparisons
- Multiple conditions
- Nested logic using If/End If blocks

### Bulk Actions

Execute actions across multiple collected items using:
- For Each loops
- Batch updates
- Mass communications

### Remote API Integration

Call external services using:
- **Remote POST**: Send data to external endpoints
- **Remote GET**: Retrieve data from external systems
- Capture and use response data in subsequent actions
- OAuth 2.0 support via ProcFu middleware

## Version History and Testing

- **Version History**: Track changes to flows over time
- **Manual Run**: Test flows before activation using manual triggers
- **Flow Logs**: Monitor execution history and debug issues
- **Webhook Logs**: Track webhook calls and responses

## Globiflow vs Podio Native Flows

| Feature | Podio Native Flows | Globiflow/Workflow Automation |
|---------|-------------------|-------------------------------|
| **Triggers** | 3 basic (create, update, delete) | 11+ including time-based, external |
| **Actions** | 6 basic effects | 24+ comprehensive actions |
| **Data Collection** | None | 5 collector types |
| **Logic** | Basic filters only | 9 logic operations + PHP |
| **Conditionals** | Simple field filters | Complex If/Then/Else with PHP |
| **Loops** | Not supported | For Each loops supported |
| **External APIs** | Basic webhook only | Full GET/POST with response handling |
| **Testing** | Limited | Manual run + detailed logs |
| **API Access** | Yes (REST API) | Limited (no official API) |

## Migration Considerations

When migrating Globiflow workflows between Podio organizations/apps:

### Challenges

1. **No Official API**: Globiflow does not expose a public REST API like Podio's native flows
2. **Complex Structures**: Collectors, logic, and actions create intricate dependencies
3. **Field ID Remapping**: All field references must be remapped to target app fields
4. **External Dependencies**: Remote POST endpoints, webhooks, and integrations must be updated
5. **Custom Variables**: PHP calculations may reference field IDs that need remapping

### Migration Approach

**Phase 1: Discovery**
- Document all flows in source app
- Identify collectors and their data sources
- Map all field references and custom variables
- Note external API endpoints and integrations

**Phase 2: Field Mapping**
- Clone source app to target organization
- Create comprehensive field ID mapping (source → target)
- Map external app references if collectors pull from other apps

**Phase 3: Flow Recreation**
- Manually recreate each flow in target app (no API available)
- Use field mapping to update all field references
- Update custom variables with new field IDs
- Reconfigure collectors with target app context

**Phase 4: Validation**
- Test each flow using Manual Run feature
- Verify collectors retrieve correct data
- Validate actions execute as expected
- Check webhook endpoints and external integrations

### Best Practices for Migration

1. **Document First**: Screenshot or export flow configurations before migration
2. **Map All Fields**: Create comprehensive field mapping spreadsheet
3. **Test Incrementally**: Validate each flow immediately after recreation
4. **Update Webhooks**: Change all webhook URLs to target environment
5. **Check Permissions**: Ensure target workspace users have proper access
6. **Monitor Logs**: Use flow logs to verify execution in target environment

## ProcFu Integration

**ProcFu** is a companion tool that extends Globiflow capabilities:

- **Middleware Scripts**: Hosted scripts for Remote POST/GET actions
- **Browser Extension**: Simplifies adding and troubleshooting Remote POST actions
- **OAuth 2.0 Support**: Handles authentication for external API calls
- **Enhanced Debugging**: Better logging and error handling

Resources:
- ProcFu Scripts: http://procfu.com/scripts/
- ProcFu Documentation: https://procfuguide.com/
- Chrome Extension: Available in Chrome Web Store

## Documentation Resources

Official documentation is available at:
- **Main Hub**: https://docs.sharefile.com/en-us/podio/using-podio/using-apps/workflow-automation.html
- **Getting Started**: https://docs.sharefile.com/en-us/podio/using-podio/workflow-automation/getting-started.html
- **Collectors, Logic & Actions**: https://docs.sharefile.com/en-us/podio/using-podio/workflow-automation/collectors-logic-actions.html
- **Flow Triggers**: https://docs.sharefile.com/en-us/podio/using-podio/workflow-automation/using-flow-triggers.html
- **Best Practices**: https://docs.sharefile.com/en-us/podio/using-podio/tips-and-tricks/top-ten-best-practices-for-podio-workflow-automation.html
- **Workflow Homepage**: https://workflow-automation.podio.com/

## API Limitations

⚠️ **Critical**: Globiflow does NOT provide a public REST API for programmatic workflow management. Unlike Podio's native flows (which can be created/updated via `/flow/` endpoints), Globiflow workflows must be managed through the web interface.

This means:
- Workflows cannot be cloned programmatically
- Field references cannot be automatically remapped
- Migration requires manual recreation in target apps
- No API-based backup or version control

## Use Cases

Common Globiflow automation scenarios:

1. **Complex Approval Workflows**: Multi-step approvals with conditional routing
2. **Data Synchronization**: Keep related apps in sync across workspaces
3. **Notification Systems**: Advanced alerting based on complex conditions
4. **Report Generation**: Automated PDF/Excel generation and distribution
5. **Integration Pipelines**: Connect Podio with external systems via APIs
6. **Task Management**: Dynamic task creation and assignment based on item data
7. **Time-Based Automation**: Scheduled actions and recurring processes

## Troubleshooting

Common issues and solutions:

1. **Flows Not Triggering**: Check filters, ensure flow is active, verify trigger conditions
2. **Collector Returns No Data**: Verify search criteria, check app references
3. **Actions Failing**: Review action limits, check field permissions
4. **Remote POST Errors**: Validate endpoint URL, check authentication
5. **PHP Calculation Errors**: Verify syntax, ensure field references exist

## Related Files

- **Podio Native Flows API**: See `07-flows.md` for Podio's basic flow system
- **Hooks API**: See `08-hooks.md` for webhook management
- **Migration Guide**: See `09-workflow-migration-guide.md` for general workflow migration strategies
