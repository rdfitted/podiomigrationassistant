# Podio Migration Agent

An AI-powered assistant for migrating Podio data between organizations. Built with Next.js 15 and Vercel AI SDK v5, this tool uses GPT-4 with tool calling to perform large-scale data migrations, workspace structure cloning, and intelligent field mapping.

## ✨ Features

### Primary Capabilities: Data Migration
- **Large-Scale Item Migration**: Optimized for migrating 80,000+ items with intelligent batching (100-1000 items/batch) and rate limit handling
- **Smart Duplicate Detection**: Match items across apps using any text/number/email/calculation field to detect duplicates before creation
- **Configurable Duplicate Handling**: Skip duplicates, update existing items, or fail on conflicts - you choose the strategy
- **Match Field Validation**: Automatically validates that match fields are suitable for comparison (excludes complex types like app references, contacts, dates)
- **Progress Tracking**: Real-time monitoring with detailed statistics (processed, successful, failed, throughput, ETA)
- **Error Recovery**: Automatic retry logic with exponential backoff and detailed failure categorization
- **Export/Import Tools**: Backup items to JSON/NDJSON files or import from external sources with validation
- **Cache Management**: Intelligent app structure caching with automatic invalidation on field errors

### Secondary Capabilities: Structure Migration
- **Workspace Structure Cloning**: Clone spaces and apps with automatic field mapping generation
- **Webhook Cloning**: Duplicate webhooks to new apps with URL verification
- **Globiflow Discovery**: Document Globiflow workflows for manual recreation (no API available)
- **Field Mapping**: Automatic field mapping by external_id with support for custom mappings
- **Field Type Filtering**: Automatically excludes read-only fields (calculation, created_on, created_by, etc.) from target mappings
- **Dry-Run Mode**: Preview changes and validate data before executing migrations

## 🚀 Quick Start

### Prerequisites

- **Node.js** 18+ (for native FormData and fetch support)
- **Podio Account** with API credentials
- **OpenAI API Key** (for GPT-4)

### Installation

```bash
# Clone the repository
git clone https://github.com/rdfitted/podiomigrationassistant.git
cd podiomigrationassistant

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env.local
```

### Configuration

Create a `.env.local` file with the following variables:

```bash
# Required: OpenAI API Key for AI agent
OPENAI_API_KEY=sk-...

# Required: Podio API Credentials
PODIO_CLIENT_ID=your-client-id
PODIO_CLIENT_SECRET=your-client-secret

# Optional: Podio API Configuration
PODIO_API_BASE=https://api.podio.com  # default
```

### Initial Setup

1. **Start the development server**:
   ```bash
   npm run dev
   ```

2. **Authorize with Podio**:
   - Visit `http://localhost:3000/api/auth/podio/authorize`
   - Complete OAuth flow to obtain access tokens
   - Tokens are automatically managed and refreshed

3. **Access the application**:
   - Open `http://localhost:3000` in your browser
   - Start using the AI-powered migration assistant

## 📖 Usage

### Item Migration (Primary Use Case)

For migrating large datasets (80,000+ items) between apps:

```typescript
// The AI agent handles this, but here's what happens under the hood:

1. Discovery Phase
   - Analyze source and target app structures
   - Generate automatic field mappings
   - Validate field type compatibility
   - Count total items to migrate

2. Migration Execution
   - Batch processing (100-1000 items per batch, default: 500)
   - Concurrent requests with rate limit handling (1-10 concurrent, default: 5)
   - Smart duplicate detection via match fields
   - Configurable duplicate behavior (skip/error/update)
   - Progress tracking with real-time statistics

3. Validation
   - Verify item counts (source vs target)
   - Check data integrity with sample validation
   - Review migration logs for errors
   - Generate migration reports
```

### Common Workflows

#### Basic Data Migration
```
User: "Migrate all items from app 12345 to app 67890"

AI Agent:
- Analyzes both app structures
- Creates automatic field mapping (matching external_ids)
- Validates field type compatibility
- Executes migration in batches with progress updates
- Reports: total processed, successful, failed, throughput
```

#### Migration with Duplicate Detection
```
User: "Migrate items from app 12345 to app 67890, but skip items that already exist based on 'Order Number' field"

AI Agent:
- Analyzes app structures
- Validates 'Order Number' field is suitable for matching (text/number/email/etc)
- Configures migration with:
  - sourceMatchField: 'order-number' (external_id)
  - targetMatchField: 'order-number' (external_id)
  - duplicateBehavior: 'skip'
- Processes items, checking for duplicates before creation
- Reports: new items created, duplicates skipped
```

#### Update Existing Items
```
User: "Update items in app 67890 with data from app 12345, matching by 'Customer Email' field"

AI Agent:
- Sets up migration with:
  - sourceMatchField: 'customer-email'
  - targetMatchField: 'customer-email'
  - duplicateBehavior: 'update'
- For each source item:
  - Searches target app by email
  - Updates matching item if found
  - Creates new item if no match
- Reports: items updated, items created, items failed
```

#### Error on Duplicates
```
User: "Import items from app 12345 to app 67890, but fail if any duplicates exist based on 'Invoice ID'"

AI Agent:
- Configures migration with:
  - sourceMatchField: 'invoice-id'
  - targetMatchField: 'invoice-id'
  - duplicateBehavior: 'error'
  - stopOnError: true (optional)
- Stops migration if duplicate detected
- Reports which item caused the duplicate error
```

#### Export/Import Workflows
```
User: "Export all items from app 12345 to a JSON file for backup"

AI Agent:
- Streams items in batches to avoid memory issues
- Writes to data/exports/app-12345.json
- Reports: total items exported, file path

User: "Import items from data/exports/app-12345.json to app 67890"

AI Agent:
- Validates JSON structure
- Performs dry-run validation (optional)
- Imports in batches
- Reports: processed, successful, failed
```

## 🏗️ Architecture

### Layered Design

```
┌─────────────────────────────────────┐
│  Frontend Layer (React + AI SDK)    │  Chat interface, UI components
├─────────────────────────────────────┤
│  Agent Layer (AI Tool Calling)      │  GPT-4 with structured tools
├─────────────────────────────────────┤
│  Tool Layer (Migration Tools)       │  Podio operation abstractions
├─────────────────────────────────────┤
│  Migration Layer (Business Logic)   │  Planning, execution, state
├─────────────────────────────────────┤
│  Podio SDK Layer (API Client)       │  HTTP client, auth, resources
└─────────────────────────────────────┘
```

### Key Components

- **Authentication System** (`lib/podio/auth/`): OAuth 2.0 with automatic token refresh
- **HTTP Client** (`lib/podio/http/`): Singleton client with retry logic and rate limiting
- **Migration Engine** (`lib/migration/items/`): Batch processor with error handling
- **State Management** (`lib/migration/state-store.ts`): Persistent migration job tracking
- **File Transfer** (`lib/podio/resources/files.ts`): Download, upload, and attachment handling

### Data Flow

```
User Input → AI Agent → Tool Selection → Migration Planning
    ↓
Batch Processing → Rate Limit Handling → Item Creation/Update
    ↓
File Transfer → Progress Tracking → Completion Report
```

## 🛠️ Development

### Commands

```bash
# Development server with Turbo
npm run dev

# Production build
npm run build

# Start production server
npm start

# Lint code
npm run lint

# Reconstruct failed items (utility)
npm run reconstruct-failed
```

### Project Structure

```
podio-agent/
├── app/                          # Next.js 15 app directory
│   ├── api/                      # API routes
│   │   ├── agent/               # AI agent endpoint
│   │   ├── auth/                # OAuth endpoints
│   │   └── migration/           # Migration API
│   ├── components/              # React components
│   └── page.tsx                 # Main chat interface
├── lib/
│   ├── ai/                      # AI SDK integration
│   │   ├── tools.ts            # Tool definitions
│   │   └── schemas/            # Zod schemas
│   ├── migration/              # Migration logic
│   │   ├── items/              # Item migration
│   │   ├── state-store.ts      # Job persistence
│   │   └── logging.ts          # Migration logs
│   └── podio/                  # Podio SDK
│       ├── auth/               # Authentication
│       ├── http/               # HTTP client
│       └── resources/          # API resources
├── data/                        # Persistent data
│   └── migrations/             # Migration job state
├── logs/                        # Application logs
│   └── podio-token-cache.json # OAuth tokens
└── aidocs/                      # AI context documentation
```

## 📊 Migration Features

### Duplicate Detection & Matching
- **Match Field Selection**: Use any compatible field type (text, number, email, calculation, phone, money, etc.)
- **Field Validation**: Automatically rejects incompatible match fields (app references, contacts, dates, files)
- **Duplicate Strategies**:
  - `skip`: Check for duplicates before creating, skip if exists
  - `error`: Fail migration if duplicate detected (useful for data integrity)
  - `update`: Update existing items instead of creating duplicates
- **Performance**: Prefetch cache for fast duplicate lookups (reduces API calls by 90%+)
- **Logging**: Detailed duplicate detection logs for troubleshooting

### Batch Processing
- Configurable batch sizes (100-1000 items, default: 500)
- Concurrent request handling (1-10 concurrent, default: 5)
- Automatic rate limit detection and pausing
- Memory-efficient streaming for large datasets (80,000+ items)

### Error Handling
- Per-item retry with exponential backoff (max 3 attempts)
- Error categorization (rate limits, validation, API errors, duplicate conflicts)
- Failed item tracking with detailed error messages and context
- Partial success support (continue on errors or stop on first failure)
- Automatic cache clearing on field-not-found errors

### Progress Tracking
- Real-time progress updates (processed, successful, failed, duplicates)
- Estimated time remaining (ETA)
- Throughput metrics (items/second, batches/minute)
- Detailed migration logs (JSON format at logs/migration.log)
- Per-migration state persistence (data/migrations/{jobId}.json)

## 🔧 Troubleshooting

### Common Issues

#### "No cached token found"
**Solution**: Visit `/api/auth/podio/authorize` to reauthorize

#### Rate Limit Errors
**Solution**: The system automatically handles rate limits by pausing. If persistent, reduce concurrency or batch size.

#### File Transfer Failures
**Solution**: Check that:
- Source items have files attached
- OAuth token has file access permissions
- Network connection is stable

#### Field Mapping Errors
**Solution**:
- Verify field types match between source and target
- Check for read-only fields (calculation, created_on, etc.)
- Use custom field mapping if auto-mapping fails

#### Duplicate Detection Not Working
**Solution**:
- Verify match field exists in both apps with same external_id
- Check that match field type is compatible (text, number, email, etc.)
- Ensure match field contains unique values
- Review logs for "incompatible match field type" errors

#### "Incompatible match field type" Error
**Solution**: The field type cannot be used for matching. Valid types include:
- text, number, email, calculation, phone, money, duration, location, question
- Invalid types: app (references), contact, date, file, image, embed, created_on, created_by

#### Stale Cache Issues
**Solution**:
- Use `clearAppCache` tool via AI agent
- Or call `DELETE /api/cache/{appId}` REST endpoint
- System auto-clears cache on field-not-found errors

### Logs

- **Migration Logs**: `logs/migration.log` - Structured JSON logs with duplicate detection details
- **Podio SDK Logs**: `logs/podio-sdk.log` - API call details
- **Job State**: `data/migrations/{jobId}.json` - Per-migration state with duplicate counts
- **Failed Items**: `logs/failed-items-{jobId}.json` - Detailed failure logs with match field values

## ⚠️ Important Notes

### Globiflow Workflows
Globiflow (Podio Workflow Automation) **has no public API**. While this tool can discover and document workflows, they must be manually recreated in target apps with field references updated.

### File Transfer Considerations
- Maximum file size: 100MB per file (Podio limitation)
- Files are downloaded and re-uploaded (not copied directly)
- Large file migrations may be slow depending on network speed
- File transfer requires additional API calls (count toward rate limits)

### Rate Limits
Podio enforces API rate limits. The system automatically:
- Tracks remaining quota
- Pauses when approaching limits
- Resumes after reset
- Logs all rate limit events

## 🤝 Contributing

This project uses:
- **TypeScript** for type safety
- **ESLint** for code quality
- **Next.js 15** app router
- **Vercel AI SDK v5** for agent functionality
- **Zod** for schema validation

## 📄 License

Private repository. All rights reserved.

## 🔗 Resources

- [Podio API Documentation](https://developers.podio.com/doc)
- [Next.js Documentation](https://nextjs.org/docs)
- [Vercel AI SDK](https://sdk.vercel.ai/docs)

---

**Built with ❤️ using Claude Code**
