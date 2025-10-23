# Podio Migration Agent

An AI-powered assistant for migrating Podio data between organizations. Built with Next.js 15 and Vercel AI SDK v5, this tool uses GPT-4 with tool calling to perform large-scale data migrations, workspace structure cloning, and intelligent field mapping.

## ✨ Features

### Primary Capabilities
- **Large-Scale Data Migration**: Optimized for migrating 80,000+ items with intelligent batching and rate limit handling
- **File Transfer**: Automatic transfer of file attachments between items
- **Duplicate Detection**: Smart duplicate handling with configurable strategies (skip, update, error)
- **Progress Tracking**: Real-time progress monitoring with detailed statistics
- **Error Recovery**: Automatic retry logic with exponential backoff and failure categorization

### Secondary Capabilities
- **Workspace Structure Migration**: Clone spaces and apps with field mapping
- **Webhook Cloning**: Duplicate webhooks to new apps
- **Globiflow Discovery**: Document Globiflow workflows (manual recreation required)
- **Field Mapping**: Automatic and custom field mapping with type validation
- **Dry-Run Mode**: Preview changes before executing migrations

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
   - Generate field mappings
   - Count total items

2. Migration Execution
   - Batch processing (500-1000 items per batch)
   - Concurrent requests with rate limit handling
   - File transfer (optional)
   - Progress tracking

3. Validation
   - Verify item counts
   - Check data integrity
   - Review error logs
```

### Common Workflows

#### Basic Data Migration
```
User: "Migrate all items from app 12345 to app 67890"

AI Agent:
- Analyzes both app structures
- Creates field mapping
- Executes migration with progress updates
- Reports success/failure statistics
```

#### Migration with File Transfer
```
User: "Copy all items from app 12345 to app 67890 including file attachments"

AI Agent:
- Performs item migration
- Downloads files from source items
- Re-uploads and attaches to target items
- Tracks file transfer success rates
```

#### Duplicate Handling
```
User: "Update existing items in app 67890 with data from app 12345, matching by 'Order ID' field"

AI Agent:
- Matches items using specified field
- Updates only existing items
- Skips or errors on duplicates (configurable)
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

### Batch Processing
- Configurable batch sizes (default: 500 items)
- Concurrent request handling (default: 5)
- Automatic rate limit detection and pausing
- Memory-efficient streaming for large datasets

### Error Handling
- Per-item retry with exponential backoff (max 3 attempts)
- Error categorization (rate limits, validation, API errors)
- Failed item tracking with detailed error messages
- Partial success support (continue on errors)

### File Transfer
- Download files using Podio API (`GET /file/{id}/raw`)
- Upload with proper multipart/form-data encoding
- Automatic file attachment to target items
- Concurrent file transfers with configurable limits

### Progress Tracking
- Real-time progress updates (processed, successful, failed)
- Estimated time remaining
- Throughput metrics (items/second, batches/minute)
- Detailed migration logs

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

### Logs

- **Migration Logs**: `logs/migration.log` - Structured JSON logs
- **Podio SDK Logs**: `logs/podio-sdk.log` - API call details
- **Job State**: `data/migrations/{jobId}.json` - Per-migration state

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
