# Vercel AI SDK Documentation

## Quick Reference for Podio Migration Agent

This documentation covers everything you need to build the Podio workflow migration agent using Vercel AI SDK v5.

## Documentation Structure

| # | File | Topic | When to Use |
|---|------|-------|-------------|
| 01 | [Overview](01-overview.md) | Introduction, core concepts | Start here |
| 02 | [Setup & Installation](02-setup-installation.md) | Next.js project setup | Phase 1 |
| 03 | [Chat Interface](03-chat-interface.md) | useChat hook, UI components | Phase 1, 4 |
| 04 | [streamText API](04-streamtext-api.md) | Backend API implementation | Phase 1, 3 |
| 05 | [Tool Calling](05-tool-calling.md) | Defining and using tools | Phase 3 |
| 06 | [OpenAI Provider](06-openai-provider.md) | GPT-5 setup and config | Phase 1, 3 |
| 07 | [Agents](07-agents.md) | Multi-step agent workflows | Phase 5 |

## Quick Start Path

### Phase 1: Get Basic Chat Working
1. Read: [Setup & Installation](02-setup-installation.md)
2. Read: [Chat Interface](03-chat-interface.md)
3. Read: [streamText API](04-streamtext-api.md)

### Phase 3: Add Podio Operations
1. Read: [Tool Calling](05-tool-calling.md)
2. Reference: Podio API docs in `../Podio API/`

### Phase 5: Build Complete Agent
1. Read: [Agents](07-agents.md)
2. Implement multi-step migration workflows

## Key Concepts

### Frontend: useChat Hook

```typescript
import { useChat } from 'ai/react';

const { messages, input, handleInputChange, handleSubmit } = useChat();
```

**What it does**:
- Manages chat state
- Handles streaming
- Shows tool invocations
- Provides error handling

**See**: [03-chat-interface.md](03-chat-interface.md)

### Backend: streamText Function

```typescript
import { streamText } from 'ai';

const result = streamText({
  model: openai('gpt-5'),
  messages,
  tools: { /* Podio tools */ },
});
```

**What it does**:
- Generates streaming responses
- Executes tool calls
- Manages multi-step workflows

**See**: [04-streamtext-api.md](04-streamtext-api.md)

### Tools: Enable Actions

```typescript
import { tool } from 'ai';
import { z } from 'zod';

const getPodioApps = tool({
  description: 'Get apps from Podio',
  parameters: z.object({
    spaceId: z.number(),
  }),
  execute: async ({ spaceId }) => {
    return await podioClient.get(`/app/space/${spaceId}/`);
  },
});
```

**What it does**:
- Lets LLM call your functions
- Type-safe with Zod
- Fully async

**See**: [05-tool-calling.md](05-tool-calling.md)

## Common Code Patterns

### Basic Chat Interface

```typescript
'use client';
import { useChat } from 'ai/react';

export default function Chat() {
  const { messages, input, handleInputChange, handleSubmit, isLoading } = useChat({
    api: '/api/agent',
  });

  return (
    <div>
      {messages.map(m => (
        <div key={m.id}>{m.role}: {m.content}</div>
      ))}

      <form onSubmit={handleSubmit}>
        <input value={input} onChange={handleInputChange} />
        <button disabled={isLoading}>Send</button>
      </form>
    </div>
  );
}
```

### Basic API Route

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

### With Tools

```typescript
import { streamText, tool } from 'ai';
import { z } from 'zod';

export async function POST(req: Request) {
  const { messages } = await req.json();

  const result = streamText({
    model: openai('gpt-5'),
    messages,
    tools: {
      myTool: tool({
        description: 'Does something',
        parameters: z.object({ param: z.string() }),
        execute: async ({ param }) => {
          return { result: 'done' };
        },
      }),
    },
  });

  return result.toDataStreamResponse();
}
```

## Observability

### See Tool Calls in UI

```typescript
{message.toolInvocations?.map((tool, idx) => (
  <div key={idx}>
    🔧 {tool.toolName}({JSON.stringify(tool.args)})
    {tool.result && <div>✓ Result: {JSON.stringify(tool.result)}</div>}
  </div>
))}
```

### Log Tool Calls in Backend

```typescript
const result = streamText({
  model: openai('gpt-5'),
  messages,
  tools: podioTools,
  onStepFinish: ({ stepType, toolCalls }) => {
    console.log('Step:', stepType);
    toolCalls?.forEach(call => {
      console.log(`  Tool: ${call.toolName}`, call.args);
    });
  },
});
```

## Configuration for This Project

### Recommended Model Settings

```typescript
import { openai } from '@ai-sdk/openai';

const agentModel = openai('gpt-5', {
  temperature: 0,        // Deterministic for tool calling
  maxTokens: 4000,       // Enough for complex responses
});
```

### Recommended Agent Settings

```typescript
const result = streamText({
  model: agentModel,
  system: 'You are a Podio migration assistant...',
  messages,
  tools: podioTools,
  maxSteps: 20,          // Allow complex multi-step workflows
  onStepFinish: logStep, // Log each step for observability
});
```

## Installation

```bash
# Core packages
npm install ai @ai-sdk/openai zod

# React hooks (included in ai package)
# import { useChat } from 'ai/react'
```

## Environment Variables

```bash
# .env.local
OPENAI_API_KEY=sk-your-key-here
PODIO_CLIENT_ID=your-client-id
PODIO_CLIENT_SECRET=your-secret
PODIO_USERNAME=your@email.com
PODIO_PASSWORD=your-password
```

## Troubleshooting

### "Cannot find module 'ai'"
```bash
rm -rf node_modules package-lock.json
npm install
```

### Streaming not working
- Ensure API route returns `result.toDataStreamResponse()`
- Check Network tab for streaming response

### Type errors with useChat
```typescript
// Make sure to import from 'ai/react', not 'ai'
import { useChat } from 'ai/react';
```

### Tools not being called
- Check tool descriptions are clear
- Verify parameter schemas match
- Try temperature: 0

## Best Practices

### 1. Always Use System Prompts

```typescript
system: 'You are a Podio migration assistant. You help users...'
```

### 2. Set maxSteps for Agents

```typescript
maxSteps: 10 // Prevent infinite loops
```

### 3. Use temperature: 0 for Tool Calling

```typescript
model: openai('gpt-5', { temperature: 0 })
```

### 4. Add Observability

```typescript
onStepFinish: (step) => console.log(step),
onFinish: (result) => console.log(result),
```

### 5. Handle Errors in Tools

```typescript
execute: async ({ param }) => {
  try {
    const result = await doWork(param);
    return { success: true, result };
  } catch (error) {
    return { success: false, error: error.message };
  }
}
```

## Common Issues

### Agent loops forever
- Set `maxSteps`
- Add `stopWhen` condition

### Agent doesn't use tools
- Improve tool descriptions
- Try temperature: 0

### Expensive API costs
- Use `maxTokens` limit
- Use `gpt-5-mini` for simple tasks
- Monitor usage with `onFinish`

## Additional Resources

- **Official Docs**: https://ai-sdk.dev/docs
- **Examples**: https://github.com/vercel/ai/tree/main/examples
- **Discord**: https://discord.gg/vercel
- **GitHub**: https://github.com/vercel/ai

## Related Documentation

- **Podio API**: See `../Podio API/` for Podio-specific docs
- **Roadmap**: See `../../ROADMAP.md` for project plan
- **Architecture**: Will be in `../../ARCHITECTURE.md`

## Summary

**For Chat UI**: Use `useChat()` hook → [03-chat-interface.md](03-chat-interface.md)

**For Backend**: Use `streamText()` → [04-streamtext-api.md](04-streamtext-api.md)

**For Actions**: Define `tool()` → [05-tool-calling.md](05-tool-calling.md)

**For Agents**: Use maxSteps + tools → [07-agents.md](07-agents.md)

**For GPT-5**: Configure `openai()` → [06-openai-provider.md](06-openai-provider.md)

Start with [01-overview.md](01-overview.md) for complete introduction.
