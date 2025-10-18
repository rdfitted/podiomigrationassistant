# Setup & Installation - Next.js App Router

## Prerequisites

- Node.js 18+ installed
- Basic understanding of Next.js App Router
- OpenAI API key

## Step 1: Create Next.js Project

```bash
npx create-next-app@latest podio-agent
cd podio-agent
```

When prompted, select:
- ✅ TypeScript
- ✅ ESLint
- ✅ Tailwind CSS (optional but recommended)
- ✅ `src/` directory: **No** (use `app/` directly)
- ✅ App Router: **Yes**
- ✅ Turbopack: **Yes** (faster dev server)
- ❌ Custom import alias: No (use default `@/`)

## Step 2: Install AI SDK Dependencies

```bash
npm install ai @ai-sdk/openai zod
```

**Package breakdown**:
- `ai` - Core AI SDK (streamText, useChat, etc.)
- `@ai-sdk/openai` - OpenAI provider (GPT-5 support)
- `zod` - Schema validation for tool parameters

## Step 3: Set Up Environment Variables

Create `.env.local` in project root:

```bash
# OpenAI API Key (required)
OPENAI_API_KEY=sk-your-openai-api-key

# Podio API Credentials (for later)
PODIO_CLIENT_ID=your-client-id
PODIO_CLIENT_SECRET=your-client-secret
PODIO_USERNAME=your@email.com
PODIO_PASSWORD=your-password
```

**Important**: Add `.env.local` to `.gitignore` (should be there by default)

## Step 4: Verify Installation

Create a test API route to verify everything works:

**`app/api/test/route.ts`**:
```typescript
import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';

export async function GET() {
  const { text } = await generateText({
    model: openai('gpt-5'),
    prompt: 'Say hello!',
  });

  return Response.json({ text });
}
```

Start dev server:
```bash
npm run dev
```

Test the endpoint:
```bash
curl http://localhost:3000/api/test
```

You should see: `{"text":"Hello! How can I assist you today?"}`

## Step 5: Create Chat API Route

**`app/api/agent/route.ts`**:
```typescript
import { streamText } from 'ai';
import { openai } from '@ai-sdk/openai';

export async function POST(req: Request) {
  const { messages } = await req.json();

  const result = streamText({
    model: openai('gpt-5'),
    messages,
  });

  return result.toDataStreamResponse();
}
```

## Step 6: Create Chat UI

**`app/page.tsx`**:
```typescript
'use client';

import { useChat } from 'ai/react';

export default function Chat() {
  const { messages, input, handleInputChange, handleSubmit, isLoading } = useChat({
    api: '/api/agent',
  });

  return (
    <div className="flex flex-col h-screen max-w-4xl mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">Podio Migration Agent</h1>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-4 mb-4">
        {messages.map(message => (
          <div
            key={message.id}
            className={`p-4 rounded-lg ${
              message.role === 'user'
                ? 'bg-blue-100 ml-auto max-w-[80%]'
                : 'bg-gray-100 mr-auto max-w-[80%]'
            }`}
          >
            <div className="font-semibold mb-1">
              {message.role === 'user' ? 'You' : 'Agent'}
            </div>
            <div className="whitespace-pre-wrap">{message.content}</div>
          </div>
        ))}

        {isLoading && (
          <div className="bg-gray-100 p-4 rounded-lg max-w-[80%]">
            <div className="animate-pulse">Thinking...</div>
          </div>
        )}
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          value={input}
          onChange={handleInputChange}
          placeholder="Ask me to migrate Podio workflows..."
          className="flex-1 p-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          type="submit"
          disabled={isLoading}
          className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400"
        >
          Send
        </button>
      </form>
    </div>
  );
}
```

## Step 7: Test the Chat

1. Start dev server: `npm run dev`
2. Open http://localhost:3000
3. Type a message and hit Send
4. You should see GPT-5 respond in real-time!

## Project Structure After Setup

```
podio-agent/
├── app/
│   ├── page.tsx              # Chat UI
│   ├── layout.tsx            # Root layout
│   └── api/
│       └── agent/
│           └── route.ts      # AI agent endpoint
├── .env.local                # API keys (not committed)
├── package.json
├── tsconfig.json
├── next.config.js
└── tailwind.config.ts
```

## Troubleshooting

### "Cannot find module 'ai'"
```bash
# Delete node_modules and reinstall
rm -rf node_modules package-lock.json
npm install
```

### "Invalid API key"
- Check `.env.local` has correct `OPENAI_API_KEY`
- Restart dev server after changing `.env.local`

### Type errors with `useChat`
```typescript
// Make sure to import from 'ai/react', not 'ai'
import { useChat } from 'ai/react';
```

### Streaming not working
- Ensure API route returns `result.toDataStreamResponse()`
- Check Network tab in DevTools for streaming response

## Next Steps

1. **Add Tools**: See `05-tool-calling.md` to add Podio operations
2. **Improve UI**: See `03-chat-interface.md` for observability
3. **Agent Logic**: See `07-agents.md` for multi-step workflows

## Minimal Setup Checklist

- [ ] Next.js 15 project created
- [ ] AI SDK packages installed (`ai`, `@ai-sdk/openai`, `zod`)
- [ ] `.env.local` with `OPENAI_API_KEY`
- [ ] API route at `/api/agent/route.ts`
- [ ] Chat UI at `/app/page.tsx`
- [ ] Test message successfully streams from GPT-5
- [ ] Dev server running on http://localhost:3000

## Development Workflow

```bash
# Start dev server (with Turbopack)
npm run dev

# Build for production (optional)
npm run build

# Start production server (optional)
npm start
```

## Recommended VSCode Extensions

- **ESLint**: Lint TypeScript code
- **Prettier**: Format code
- **Tailwind CSS IntelliSense**: Autocomplete for Tailwind
- **TypeScript Vue Plugin**: Better TypeScript support

## Package.json Scripts

After setup, you'll have:

```json
{
  "scripts": {
    "dev": "next dev --turbo",
    "build": "next build",
    "start": "next start",
    "lint": "next lint"
  }
}
```

## Configuration Files

### `tsconfig.json`
Default Next.js TypeScript config - no changes needed.

### `next.config.js`
```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {};

export default nextConfig;
```

No special config needed for AI SDK.

### `tailwind.config.ts`
Default Tailwind config - customize as desired.

## Success Criteria

✅ Can run `npm run dev` without errors
✅ Can open http://localhost:3000
✅ Can send a message and get GPT-5 response
✅ Messages stream in real-time (not all at once)
✅ No TypeScript errors in editor

You're now ready to build the Podio migration agent!
