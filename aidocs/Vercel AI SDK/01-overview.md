# Vercel AI SDK v5 - Overview

## What is Vercel AI SDK?

The AI SDK is a TypeScript toolkit for building AI-powered applications with Large Language Models (LLMs). It provides a unified, standardized API for working with multiple AI providers.

## Official Documentation

- **Main Site**: https://ai-sdk.dev
- **GitHub**: https://github.com/vercel/ai
- **NPM**: `ai` package

## Core Libraries

### 1. AI SDK Core
Backend functionality for AI operations:
- **Text Generation**: `generateText()`, `streamText()`
- **Structured Objects**: `generateObject()`, `streamObject()`
- **Tool Calling**: Define and execute tools
- **Agent Workflows**: Multi-step reasoning and actions

### 2. AI SDK UI
Frontend hooks for React, Vue, Svelte, and Angular:
- **`useChat()`**: Chat interface with streaming
- **`useCompletion()`**: Text completion UI
- **`useObject()`**: Structured data streaming

## Key Features

### ✅ Multi-Provider Support
Works with 15+ AI providers:
- OpenAI (GPT-5, GPT-4, etc.)
- Anthropic (Claude)
- Google (Gemini)
- xAI (Grok)
- Azure OpenAI
- Amazon Bedrock
- And more...

### ✅ Streaming by Default
Real-time response streaming for better UX:
```typescript
const result = streamText({
  model: openai('gpt-5'),
  prompt: 'Tell me a story'
});

for await (const textPart of result.textStream) {
  console.log(textPart); // Streams word by word
}
```

### ✅ Tool Calling
Enable LLMs to use external tools and APIs:
```typescript
const result = streamText({
  model: openai('gpt-5'),
  tools: {
    weather: tool({
      description: 'Get weather',
      parameters: z.object({ city: z.string() }),
      execute: async ({ city }) => getWeather(city)
    })
  }
});
```

### ✅ Type Safety
Full TypeScript support with Zod schemas:
- Type-safe tool parameters
- Validated inputs/outputs
- IntelliSense support

### ✅ Framework Agnostic
Works with any JavaScript framework:
- Next.js (App Router & Pages Router)
- Express.js
- Fastify
- SvelteKit
- Nuxt
- Vanilla JS

## Architecture for This Project

```
┌─────────────────────────────────┐
│  Frontend (React + Next.js)     │
│  - useChat() hook               │
│  - Streaming UI                 │
│  - Message display              │
└─────────────────────────────────┘
              ↓
┌─────────────────────────────────┐
│  API Route (/api/agent/route.ts)│
│  - streamText()                 │
│  - Tool definitions             │
│  - GPT-5 model                  │
└─────────────────────────────────┘
              ↓
┌─────────────────────────────────┐
│  Podio API Tools                │
│  - getApps, cloneApp, etc.      │
└─────────────────────────────────┘
```

## Quick Example

**Backend (API Route)**:
```typescript
// app/api/chat/route.ts
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

**Frontend (React Component)**:
```typescript
// app/page.tsx
'use client';
import { useChat } from 'ai/react';

export default function Chat() {
  const { messages, input, handleInputChange, handleSubmit } = useChat();

  return (
    <div>
      {messages.map(m => (
        <div key={m.id}>{m.role}: {m.content}</div>
      ))}
      <form onSubmit={handleSubmit}>
        <input value={input} onChange={handleInputChange} />
      </form>
    </div>
  );
}
```

## Why AI SDK for This Project?

### ✅ Perfect for Chat Interfaces
- Built-in `useChat()` hook handles everything
- Automatic message state management
- Streaming out-of-the-box

### ✅ Observability Built-in
- See tool calls in real-time
- Track agent progress
- Monitor errors and retries

### ✅ Tool Calling Made Easy
- Define Podio API operations as tools
- LLM decides when to call them
- Type-safe parameters with Zod

### ✅ Production Ready
- Powers v0.dev and Vercel products
- Battle-tested at scale
- Excellent documentation

### ✅ Local Development Friendly
- Works great on localhost
- No deployment needed
- Fast iteration cycle

## Core Concepts

### Messages
Conversation history between user and assistant:
```typescript
type Message = {
  id: string;
  role: 'system' | 'user' | 'assistant';
  content: string;
  toolInvocations?: ToolInvocation[];
}
```

### Tools
Functions the LLM can call:
```typescript
const myTool = tool({
  description: 'What this tool does',
  parameters: z.object({ /* Zod schema */ }),
  execute: async (params) => { /* Do work */ }
});
```

### Streaming
Send partial responses as they're generated:
- Better UX (users see progress)
- Lower perceived latency
- Can cancel mid-stream

### Providers
Model providers (OpenAI, Anthropic, etc.):
```typescript
import { openai } from '@ai-sdk/openai';
import { anthropic } from '@ai-sdk/anthropic';

const gpt5 = openai('gpt-5');
const claude = anthropic('claude-4');
```

## Installation

```bash
# Core SDK
npm install ai

# OpenAI provider
npm install @ai-sdk/openai

# React hooks
npm install ai/react

# Zod for schemas
npm install zod
```

## Next Steps

1. **Setup**: See `02-setup-installation.md`
2. **Chat UI**: See `03-chat-interface.md`
3. **Backend**: See `04-streamtext-api.md`
4. **Tools**: See `05-tool-calling.md`
5. **Agents**: See `07-agents.md`

## Resources

- **Docs**: https://ai-sdk.dev/docs
- **Examples**: https://github.com/vercel/ai/tree/main/examples
- **Discord**: https://discord.gg/vercel
- **GitHub Discussions**: https://github.com/vercel/ai/discussions
