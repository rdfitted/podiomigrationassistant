# Podio Workflow Migration Agent - Development Roadmap

## 🎯 Current Status

**Overall Progress**: 50% Complete (3/6 phases)

| Phase | Status | Completion |
|-------|--------|------------|
| Phase 1: Foundation Setup | ✅ Complete | 100% |
| Phase 2: Podio API Integration | ✅ Complete | 100% |
| Phase 3: AI Tools Implementation | ✅ Complete | 100% |
| Phase 4: Chat Interface Enhancement | ⬜ Not Started | 0% |
| Phase 5: Migration Workflow | ⬜ Not Started | 0% |
| Phase 6: Documentation & Polish | ⬜ Not Started | 0% |

**Latest Updates** (2025-10-08):
- ✅ **PIVOT**: Shifted project focus from Globiflow workflows to large-scale data/item migration (80,000+ items)
- ✅ Added comprehensive Globiflow documentation and clarified API limitations
- ✅ Updated all documentation to emphasize data migration as primary use case
- ✅ Added `maxSteps: 50` to prevent infinite tool loops
- ✅ Cleaned up legacy code (removed empty directories, obsolete comments)
- ✅ All 14 Podio tools fully operational (6 discovery, 5 structure migration, 3 validation)
- 🔄 **Next**: Implement large-scale item migration tools (migrateItems, exportItems, importItems)

**Ready for**: Phase 5 - Data Migration Implementation (refocused)

---

## Project Overview

**Goal**: Build a lightweight, local-only chat interface that uses AI (GPT-5) to migrate large-scale Podio data between organizations, with support for structure migration and workspace setup.

**Primary Focus**: Large-scale item/data migration (optimized for 80,000+ items)
**Secondary Focus**: Workspace structure migration (apps, spaces, webhooks)

**Stack**:
- Vercel AI SDK v5 (GPT-5)
- Next.js 15 (App Router)
- TypeScript
- Podio API integration
- Local development only (no authentication, hard-coded credentials)

**Key Principle**: Lightweight and practical. Get working fast, iterate as needed.

**Note on Globiflow**: While this tool provides discovery for Globiflow workflows, they cannot be migrated programmatically (no public API). Focus is on data and structure migration.

## 📚 Documentation Reference

All necessary documentation is available in `aidocs/`:

### Vercel AI SDK Documentation (`aidocs/Vercel AI SDK/`)
- **[01-overview.md](Vercel AI SDK/01-overview.md)** - AI SDK introduction, core concepts
- **[02-setup-installation.md](Vercel AI SDK/02-setup-installation.md)** - Complete Next.js setup guide ⭐ **Start here for Phase 1**
- **[03-chat-interface.md](Vercel AI SDK/03-chat-interface.md)** - useChat hook, UI components, observability
- **[04-streamtext-api.md](Vercel AI SDK/04-streamtext-api.md)** - Backend API, streaming, callbacks
- **[05-tool-calling.md](Vercel AI SDK/05-tool-calling.md)** - Tool definitions with Podio examples ⭐ **Phase 3**
- **[06-openai-provider.md](Vercel AI SDK/06-openai-provider.md)** - GPT-5 setup and configuration
- **[07-agents.md](Vercel AI SDK/07-agents.md)** - Multi-step agents, complete Podio agent ⭐ **Phase 5**
- **[README.md](Vercel AI SDK/README.md)** - Quick reference, common patterns

### Podio API Documentation (`aidocs/Podio API/`)
- **[01-overview.md](Podio API/01-overview.md)** - Podio API architecture
- **[02-authentication.md](Podio API/02-authentication.md)** - OAuth 2.0 flows ⭐ **Phase 2**
- **[03-organizations.md](Podio API/03-organizations.md)** - Organizations API reference
- **[04-spaces.md](Podio API/04-spaces.md)** - Spaces/workspaces API reference
- **[05-applications.md](Podio API/05-applications.md)** - Apps and fields API ⭐ **Phase 3**
- **[06-items.md](Podio API/06-items.md)** - Items/records API reference
- **[07-flows.md](Podio API/07-flows.md)** - Podio Native Flows API (simple workflows - NOT Globiflow)
- **[08-hooks.md](Podio API/08-hooks.md)** - Webhooks API reference ⭐ **Phase 3, 5**
- **[09-workflow-migration-guide.md](Podio API/09-workflow-migration-guide.md)** - Complete migration guide ⭐ **Phase 5**
- **[10-globiflow-workflow-automation.md](Podio API/10-globiflow-workflow-automation.md)** - Globiflow documentation (⚠️ NO API) ⭐ **Phase 5**

---

## Architecture

```
┌─────────────────────────────────────┐
│   Frontend (Next.js + React)        │
│   ├── Chat Interface (useChat)      │
│   ├── Real-time streaming           │
│   └── Tool call observability       │
└─────────────────────────────────────┘
                 ↓
┌─────────────────────────────────────┐
│   API Route (/api/agent)            │
│   ├── Vercel AI SDK streamText      │
│   ├── GPT-5 model                   │
│   └── Podio tools                   │
└─────────────────────────────────────┘
                 ↓
┌─────────────────────────────────────┐
│   Podio API Client                  │
│   ├── Hard-coded credentials        │
│   ├── OAuth token management        │
│   └── API helper functions          │
└─────────────────────────────────────┘
                 ↓
┌─────────────────────────────────────┐
│   Podio REST API                    │
└─────────────────────────────────────┘
```

---

## Phase 1: Foundation Setup ✅ COMPLETE

**Goal**: Get basic chat interface working with GPT-5

**📖 Documentation**:
- **[Vercel AI SDK/02-setup-installation.md](Vercel AI SDK/02-setup-installation.md)** - Complete step-by-step setup
- **[Vercel AI SDK/03-chat-interface.md](Vercel AI SDK/03-chat-interface.md)** - useChat hook examples
- **[Vercel AI SDK/04-streamtext-api.md](Vercel AI SDK/04-streamtext-api.md)** - API route implementation

### Tasks

- [x] **1.1 Initialize Next.js project**
  - Create new Next.js 15 app with App Router
  - Install dependencies: `ai`, `@ai-sdk/openai`, `zod`
  - Set up TypeScript configuration
  - Create `.env.local` with OpenAI API key

- [x] **1.2 Basic chat interface**
  - Create `/app/page.tsx` with chat UI
  - Implement `useChat()` hook
  - Basic styling (minimal, functional)
  - Test GPT-5 connection

- [x] **1.3 API route setup**
  - Create `/app/api/agent/route.ts`
  - Implement basic `streamText()` handler
  - Added `maxSteps: 50` configuration
  - Verify streaming works
  - Test end-to-end chat flow

**Success Criteria**: ✅ You can chat with GPT-5 in browser at localhost:3000

**Files Created**:
- `app/page.tsx` - Chat UI
- `app/api/agent/route.ts` - AI agent endpoint
- `.env.local` - API keys

---

## Phase 2: Podio API Integration ✅ COMPLETE

**Goal**: Connect to Podio API and create helper utilities

**📖 Documentation**:
- **[Podio API/02-authentication.md](Podio API/02-authentication.md)** - OAuth 2.0 implementation, token management
- **[Podio API/03-organizations.md](Podio API/03-organizations.md)** - Organizations API reference
- **[Podio API/04-spaces.md](Podio API/04-spaces.md)** - Spaces API reference
- **[Podio API/05-applications.md](Podio API/05-applications.md)** - Applications API reference

### Tasks

- [x] **2.1 Podio authentication setup**
  - Create `lib/podio/auth/` directory structure
  - Implement OAuth 2.0 password flow
  - Hard-code credentials in `.env.local`
  - Implement token refresh logic with pre-expiry window
  - Add token storage with atomic writes
  - Test authentication

- [x] **2.2 Podio API client**
  - Create `lib/podio/http/client.ts`
  - Implement base HTTP client with auth headers
  - Add custom error handling (PodioApiError)
  - Add retry logic with exponential backoff for rate limits
  - Test basic API calls

- [x] **2.3 Podio helper functions**
  - Create `lib/podio/resources/` directory
  - Implement Organization helpers (get, list) - `organizations.ts`
  - Implement Space helpers (get, list, create) - `spaces.ts`
  - Implement App helpers (get, list, create, update) - `applications.ts`
  - Implement Globiflow helpers (get, list) - `flows.ts` (⚠️ Note: Globiflow has no create/clone API)
  - Implement Hook helpers (get, list, create, clone) - `hooks.ts`
  - Test each helper function

**Success Criteria**: ✅ Can successfully authenticate and make Podio API calls

**Files Created**:
- `lib/podio/auth/` - Complete auth module (password-flow, token-store, types)
- `lib/podio/http/` - HTTP client with retry logic
- `lib/podio/resources/` - All resource helpers (organizations, spaces, applications, flows, hooks)
- `lib/podio/types.ts` - TypeScript types for Podio entities
- `lib/podio/config.ts` - Configuration validation
- `lib/podio/errors.ts` - Custom error types
- `lib/podio/logging.ts` - Structured logging

---

## Phase 3: AI Tools Implementation ✅ COMPLETE

**Goal**: Create AI-callable tools for Podio operations

**📖 Documentation**:
- **[Vercel AI SDK/05-tool-calling.md](Vercel AI SDK/05-tool-calling.md)** - Complete tool calling guide with Podio examples ⭐
- **[Podio API/05-applications.md](Podio API/05-applications.md)** - App cloning reference
- **[Podio API/10-globiflow-workflow-automation.md](Podio API/10-globiflow-workflow-automation.md)** - Globiflow reference (⚠️ NO API)
- **[Podio API/08-hooks.md](Podio API/08-hooks.md)** - Hooks API for migration

### Tasks

- [x] **3.1 Discovery tools** (6/6 complete)
  - `listOrganizations` - Get all orgs user has access to
  - `listSpaces` - Get spaces in an organization
  - `getSpaceApps` - Get all apps in a space (with flow/hook metadata)
  - `getAppStructure` - Get app fields and configuration
  - `getAppFlows` - Get all flows for an app
  - `getAppHooks` - Get all hooks for an app

- [x] **3.2 Migration tools** (5/5 complete)
  - `createSpace` - Create new target space
  - `cloneApp` - Clone app structure to target space with field mapping
  - `cloneFlow` - Get Globiflow workflows (⚠️ Cannot clone via API - manual recreation required) ✅ **NEW**
  - `cloneHook` - Clone hook to new app
  - `updateAppReferences` - Fix cross-app reference fields

- [x] **3.3 Validation tools** (3/3 implemented)
  - `validateAppStructure` - Compare source/target app (fully implemented)
  - `testFlow` - Test flow execution (basic implementation)
  - `getMigrationStatus` - Get migration progress (basic implementation)

- [x] **3.4 Integrate tools with AI SDK**
  - Create `lib/ai/tools.ts` (373 lines, all 14 tools)
  - Define Zod schemas for each tool (483 lines in schemas.ts)
  - Implement tool execution functions in `lib/podio/migration.ts`
  - Add to streamText configuration with `maxSteps: 50` ✅ **NEW**
  - Add comprehensive system prompt with workflow guidelines
  - Add `onStepFinish` callback for observability

**Success Criteria**: ✅ Agent can discover and migrate Podio structures via chat

**Files Created**:
- `lib/ai/tools.ts` - All 14 AI tool definitions
- `lib/ai/schemas.ts` - Main schema exports
- `lib/ai/schemas/podio.ts` - Podio resource schemas
- `lib/ai/schemas/migration.ts` - Migration planning schemas
- `lib/podio/migration.ts` - Complete migration logic (485 lines)
- `lib/migration/` - Advanced orchestration (planner, executor, reporter)

---

## Phase 4: Chat Interface Enhancement (Day 6)

**Goal**: Add observability and better UX

**📖 Documentation**:
- **[Vercel AI SDK/03-chat-interface.md](Vercel AI SDK/03-chat-interface.md)** - Complete UI patterns, tool call display
- **[Vercel AI SDK/04-streamtext-api.md](Vercel AI SDK/04-streamtext-api.md)** - Callbacks and observability

### Tasks

- [ ] **4.1 Observability display**
  - Show tool calls in chat (what agent is doing)
  - Display API call status (loading, success, error)
  - Show progress for multi-step migrations
  - Add collapsible tool call details

- [ ] **4.2 UI improvements**
  - Add message timestamps
  - Improve message formatting (markdown support)
  - Add loading states
  - Add error message display
  - Add "copy to clipboard" for results

- [ ] **4.3 Session management**
  - Keep chat history in localStorage
  - Add "clear chat" button
  - Add "export conversation" feature

**Success Criteria**: Can see exactly what agent is doing at each step

**Files Updated**:
- `app/page.tsx` - Enhanced UI
- `components/Message.tsx` - Message display component
- `components/ToolCall.tsx` - Tool call display component

---

## Phase 5: Data Migration Implementation (Day 7-8) - REFOCUSED

**Goal**: Implement large-scale item/data migration capability (80,000+ items)

**📖 Documentation**:
- **[Vercel AI SDK/07-agents.md](Vercel AI SDK/07-agents.md)** - Complete agent implementation with Podio example ⭐
- **[Podio API/06-items.md](Podio API/06-items.md)** - Items API reference ⭐ **PRIMARY**
- **[Podio API/11-data-migration-guide.md](Podio API/11-data-migration-guide.md)** - Large-scale data migration patterns ⭐ **NEW**
- **[Podio API/09-workflow-migration-guide.md](Podio API/09-workflow-migration-guide.md)** - General migration guide

### Tasks

- [ ] **5.1 Data Migration Tools (PRIMARY)**
  - Implement `migrateItems` tool
    - Batch processing (500-1000 items per batch)
    - Field value mapping and transformation
    - Rate limit handling with exponential backoff
    - Progress tracking (total, migrated, failed, remaining, ETA)
    - Automatic retry logic for failed items
  - Implement `exportItems` tool
    - Export to JSON/CSV
    - Support filtering and date ranges
    - Stream large datasets
  - Implement `importItems` tool
    - Import from JSON/CSV
    - Validation before import
    - Dry-run mode
  - Implement `getItemCount` tool
    - Count items in source app
    - Support filtering
    - Estimate migration duration

- [ ] **5.2 Migration Orchestration**
  - Create migration state tracking for large datasets
  - Implement resume capability (restart from failure point)
  - Add progress reporting (percentage, items/sec, ETA)
  - Implement memory-efficient streaming for 80K+ items
  - Add sample validation (test first 100 items before full migration)

- [ ] **5.3 Agent Instructions**
  - Create comprehensive system prompt for data migration
  - Add large-scale migration examples (80K+ items)
  - Add error handling and retry strategies
  - Add safety checks (confirm before large migrations)
  - Document batch sizing recommendations

- [ ] **5.4 End-to-End Testing**
  - Test small migration (100 items)
  - Test medium migration (10,000 items)
  - Test large migration (80,000+ items)
  - Test with rate limiting
  - Test resume/restart functionality
  - Document performance metrics and limitations

**Success Criteria**: Can successfully migrate 80,000+ items between apps with progress tracking

**Files to Create**:
- `lib/podio/resources/items.ts` (ENHANCED for batch operations)
- `lib/migration/item-migrator.ts` (NEW - large-scale item migration)
- `lib/migration/batch-processor.ts` (NEW - batch processing engine)
- `lib/ai/tools/data-migration.ts` (NEW - data migration tools)
- `lib/ai/system-prompt.ts` (ENHANCED with data migration guidance)

---

## Phase 6: Documentation & Polish (Day 9)

**Goal**: Make it easy to use and maintain

### Tasks

- [ ] **6.1 User documentation**
  - Create `USER_GUIDE.md`
  - Document how to set up credentials
  - Add example migration commands
  - List supported features and limitations

- [ ] **6.2 Code documentation**
  - Add JSDoc comments to key functions
  - Document Podio API integration points
  - Document migration algorithm
  - Add inline examples

- [ ] **6.3 Configuration**
  - Create `.env.example` template
  - Add configuration validation
  - Document environment variables
  - Add startup checks

- [ ] **6.4 Testing & refinement**
  - Test all common migration scenarios
  - Fix bugs discovered during testing
  - Optimize slow operations
  - Add helpful error messages

**Success Criteria**: Anyone can clone repo, add credentials, and start migrating

**Files Created**:
- `USER_GUIDE.md` - How to use the tool
- `.env.example` - Environment template
- `ARCHITECTURE.md` - Technical overview

---

## Project Structure

```
podio-agent/
├── app/
│   ├── page.tsx                    # Main chat interface
│   ├── layout.tsx                  # App layout
│   └── api/
│       └── agent/
│           └── route.ts            # AI agent API endpoint
├── components/
│   ├── Chat.tsx                    # Chat container
│   ├── Message.tsx                 # Message display
│   ├── ToolCall.tsx                # Tool call display
│   └── Input.tsx                   # Chat input
├── lib/
│   ├── podio/
│   │   ├── auth.ts                 # OAuth authentication
│   │   ├── client.ts               # HTTP client
│   │   ├── helpers.ts              # API helpers
│   │   ├── migration.ts            # Migration logic
│   │   └── types.ts                # TypeScript types
│   ├── ai/
│   │   ├── tools.ts                # AI tool definitions
│   │   ├── schemas.ts              # Zod schemas
│   │   └── system-prompt.ts        # Agent instructions
│   └── migration/
│       ├── orchestrator.ts         # Migration coordinator
│       └── planner.ts              # Migration planning
├── aidocs/                          # Documentation
│   ├── Podio API/                   # Podio API documentation
│   ├── Vercel AI SDK/               # AI SDK documentation
│   └── ROADMAP.md                   # This file
├── .env.local                       # API keys (not committed)
├── .env.example                     # Environment template
├── package.json
├── tsconfig.json
├── next.config.js
├── ROADMAP.md                       # This file
├── USER_GUIDE.md                    # User documentation
└── ARCHITECTURE.md                  # Technical documentation
```

---

## Technology Decisions

### Core Stack
- **Next.js 15**: App Router for modern React, API routes for backend
- **Vercel AI SDK v5**: Agent framework with built-in UI hooks
- **TypeScript**: Type safety for Podio API integration
- **GPT-5**: Primary reasoning model

### Key Dependencies
```json
{
  "dependencies": {
    "ai": "^5.x",
    "@ai-sdk/openai": "^1.x",
    "zod": "^4.x",
    "next": "^15.x",
    "react": "^19.x"
  }
}
```

### No Authentication
- Running locally only
- Hard-coded Podio credentials in `.env.local`
- No user management or sessions
- No deployment considerations

### Lightweight Approach
- **No database**: Use localStorage for chat history
- **No state management**: React hooks only
- **No complex UI library**: Tailwind CSS for styling
- **No backend framework**: Next.js API routes sufficient
- **No testing framework**: Manual testing (add later if needed)

---

## Development Guidelines

### Keep It Simple
1. **Start minimal**: Get working first, optimize later
2. **Hard-code when reasonable**: No need for config UI
3. **Use AI SDK defaults**: Don't overconfigure
4. **Inline styles OK**: Tailwind classes in components
5. **Console.log for debugging**: No complex logging setup

### Code Organization
1. **One feature per file**: Easy to find and modify
2. **Co-locate types**: Define types near usage
3. **Flat structure**: Avoid deep nesting
4. **Export everything**: Makes testing easier later

### Error Handling
1. **Fail loudly**: Show errors in chat
2. **Retry automatically**: Podio rate limits
3. **Ask before destructive ops**: Confirm migrations
4. **Preserve chat history**: Don't lose context on error

---

## Success Metrics

**Phase 1**: ✅ Chat with GPT-5 works
**Phase 2**: ✅ Can authenticate and call Podio API
**Phase 3**: ✅ Agent can discover and migrate Podio structures
**Phase 4**: ⬜ Can see what agent is doing (tool observability in UI)
**Phase 5**: ⬜ Successfully migrate 80,000+ items with progress tracking (REFOCUSED)
**Phase 6**: ⬜ Someone else can use the tool (documentation complete)

---

## Known Limitations & Future Enhancements

### Known Limitations (Current v0.5)
- Local only, no deployment
- No authentication/authorization
- ⚠️ **Data migration tools not yet implemented** - need migrateItems, exportItems, importItems tools (Phase 5)
- No rollback/undo capability
- No concurrent migrations
- Single user only
- Basic UI with no tool call observability
- ⚠️ **Globiflow workflows cannot be cloned via API** - must be manually recreated in target apps
- File attachment migration not yet supported (needs separate workflow)
- Migration resume/restart capability not yet implemented

### Recently Completed
- ✅ Comprehensive Globiflow documentation (10-globiflow-workflow-automation.md)
- ✅ Clarified Globiflow vs Podio native flows distinction across all docs
- ✅ Globiflow workflow field reference remapping guidance (manual recreation required)
- ✅ `maxSteps` configuration to prevent infinite loops
- ✅ All 14 Podio tools operational
- ✅ Comprehensive error handling with PodioApiError
- ✅ Token refresh with pre-expiry window
- ✅ Retry logic with exponential backoff

### Next Priority (Phase 4)
- [ ] Tool call observability in chat UI
- [ ] Better loading states and progress indicators
- [ ] Session management with localStorage
- [ ] Enhanced error display

### Future Enhancements (Phase 5+)
- [ ] Globiflow workflow documentation/export tool (since no API available)
- [ ] Field mapping assistant for Globiflow workflow manual recreation
- [ ] Complete workflow testing (create test items, verify execution)
- [ ] Migration job state persistence
- [ ] Rollback capability
- [ ] Item migration support
- [ ] Support for multi-workspace migrations
- [ ] Migration templates (save/reuse patterns)
- [ ] Dry-run mode (preview changes)
- [ ] Detailed migration reports
- [ ] Email notifications on completion
- [ ] Web deployment with auth

---

## Getting Started

### Prerequisites
- Node.js 18+ installed
- OpenAI API key (for GPT-5)
- Podio account with API credentials
- Admin access to source and target workspaces

### Quick Start
```bash
# Phase 1 - Get started
npm create next-app@latest podio-agent
cd podio-agent
npm install ai @ai-sdk/openai zod

# Add API keys
echo "OPENAI_API_KEY=your_key" > .env.local
echo "PODIO_CLIENT_ID=your_id" >> .env.local
echo "PODIO_CLIENT_SECRET=your_secret" >> .env.local

# Start development
npm run dev
```

Open http://localhost:3000 and start chatting!

---

## Daily Development Plan

### Day 1: Foundation
- Morning: Next.js setup, basic chat UI
- Afternoon: API route, test GPT-5 connection

### Day 2-3: Podio Integration
- Day 2: Authentication, basic API client
- Day 3: Helper functions, test Podio calls

### Day 4-5: AI Tools
- Day 4: Discovery tools, tool integration
- Day 5: Migration tools, validation tools

### Day 6: UI Enhancement
- Morning: Observability display
- Afternoon: UI polish, session management

### Day 7-8: Migration Workflow
- Day 7: Orchestration, planning
- Day 8: End-to-end testing

### Day 9: Documentation
- Morning: User guide, code docs
- Afternoon: Testing, bug fixes

**Total Time**: ~9 days of focused development

---

## Notes

- **Start simple**: Get phase 1 working before moving on
- **Test frequently**: Verify each tool as you build it
- **Use the docs**: All documentation is in `aidocs/`
  - **Vercel AI SDK docs** - For frontend/backend implementation
  - **Podio API docs** - For Podio integration details
- **Ask the agent**: Use GPT-5 to help write code
- **Iterate**: Build, test, refine

This is a personal tool - prioritize working over perfect.

---

## Quick Documentation Lookup

**"How do I set up Next.js?"** → `Vercel AI SDK/02-setup-installation.md`

**"How do I create the chat UI?"** → `Vercel AI SDK/03-chat-interface.md`

**"How do I call Podio APIs?"** → `Podio API/02-authentication.md`, then relevant API docs

**"How do I add tools?"** → `Vercel AI SDK/05-tool-calling.md` (has Podio examples!)

**"How do I build the agent?"** → `Vercel AI SDK/07-agents.md` (complete agent code!)

**"How do I migrate Globiflow workflows?"** → `Podio API/10-globiflow-workflow-automation.md` + `Podio API/09-workflow-migration-guide.md`

**"What does useChat do?"** → `Vercel AI SDK/03-chat-interface.md`

**"What does streamText do?"** → `Vercel AI SDK/04-streamtext-api.md`

**"How do I show tool calls in UI?"** → `Vercel AI SDK/03-chat-interface.md` (search "tool invocations")

**"How do I clone a Podio app?"** → `Podio API/05-applications.md` + `Vercel AI SDK/05-tool-calling.md`
