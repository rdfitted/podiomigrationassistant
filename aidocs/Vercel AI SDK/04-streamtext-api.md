# streamText API - Backend Implementation

## Overview

`streamText` is the core function for generating streaming text responses from LLMs. It's used in API routes to power chat interfaces.

## Basic Usage

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

## API Reference

### Import

```typescript
import { streamText } from 'ai';
```

### Parameters

```typescript
const result = streamText({
  // Required: The language model
  model: openai('gpt-5'),

  // One of these is required:
  messages: Message[],  // For chat
  prompt: string,       // For single completion

  // Optional: System instructions
  system: string | string[],

  // Optional: Tools the model can call
  tools: {
    toolName: tool({ ... }),
  },

  // Optional: Maximum tokens to generate
  maxTokens: number,

  // Optional: Temperature (0-2, default 1)
  temperature: number,

  // Optional: Top P sampling (0-1)
  topP: number,

  // Optional: Stop sequences
  stopSequences: string[],

  // Optional: Control tool calling loops
  maxSteps: number,

  // Optional: Event callbacks
  onChunk: (chunk) => void,
  onFinish: (result) => void,
  onStepFinish: (step) => void,
});
```

### Return Value

```typescript
{
  // Stream the text
  textStream: AsyncIterable<string>,

  // Get full text (waits for completion)
  text: Promise<string>,

  // Get tool calls
  toolCalls: Promise<ToolCall[]>,

  // Get tool results
  toolResults: Promise<ToolResult[]>,

  // Usage information
  usage: Promise<{
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  }>,

  // Why generation stopped
  finishReason: Promise<'stop' | 'length' | 'content-filter' | 'tool-calls'>,

  // Convert to HTTP response
  toDataStreamResponse: (options?) => Response,
}
```

## Next.js App Router Integration

### Basic Chat Endpoint

**`app/api/chat/route.ts`**:
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

### With System Prompt

```typescript
export async function POST(req: Request) {
  const { messages } = await req.json();

  const result = streamText({
    model: openai('gpt-5'),
    system: 'You are a helpful Podio workflow migration assistant.',
    messages,
  });

  return result.toDataStreamResponse();
}
```

### With Tools

```typescript
import { tool } from 'ai';
import { z } from 'zod';

export async function POST(req: Request) {
  const { messages } = await req.json();

  const result = streamText({
    model: openai('gpt-5'),
    messages,
    tools: {
      getWeather: tool({
        description: 'Get weather for a location',
        parameters: z.object({
          location: z.string(),
        }),
        execute: async ({ location }) => {
          return { location, temp: 72 };
        },
      }),
    },
  });

  return result.toDataStreamResponse();
}
```

## Podio Agent Example

**`app/api/agent/route.ts`**:
```typescript
import { streamText, tool } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import { podioClient } from '@/lib/podio/client';

export async function POST(req: Request) {
  const { messages } = await req.json();

  const result = streamText({
    model: openai('gpt-5'),
    system: `You are a Podio workflow migration assistant.

You can help users:
- List their Podio organizations and spaces
- Discover apps and their structures
- Migrate workflows (Flows and Hooks) between workspaces
- Validate migrations

Always confirm before making changes. Be clear about what you're doing.`,
    messages,
    maxSteps: 10, // Allow multi-step tool calling

    tools: {
      listOrganizations: tool({
        description: 'List all Podio organizations the user has access to',
        parameters: z.object({}),
        execute: async () => {
          const orgs = await podioClient.get('/org/');
          return { organizations: orgs };
        },
      }),

      listSpaces: tool({
        description: 'List all spaces in an organization',
        parameters: z.object({
          orgId: z.number().describe('Organization ID'),
        }),
        execute: async ({ orgId }) => {
          const spaces = await podioClient.get(`/space/org/${orgId}/`);
          return { spaces };
        },
      }),

      getAppStructure: tool({
        description: 'Get detailed structure of a Podio app',
        parameters: z.object({
          appId: z.number().describe('App ID'),
        }),
        execute: async ({ appId }) => {
          const app = await podioClient.get(`/app/${appId}`);
          return { app };
        },
      }),
    },

    onStepFinish: ({ stepType, toolCalls, toolResults }) => {
      console.log('[Step]', stepType, {
        tools: toolCalls?.length,
        results: toolResults?.length,
      });
    },
  });

  return result.toDataStreamResponse();
}
```

## Event Callbacks

### onChunk - Process Each Chunk

```typescript
const result = streamText({
  model: openai('gpt-5'),
  messages,
  onChunk: ({ chunk }) => {
    console.log('Chunk:', chunk.text);
    // Can process/transform chunks here
  },
});
```

### onStepFinish - Track Tool Calls

```typescript
const result = streamText({
  model: openai('gpt-5'),
  messages,
  tools: { /* ... */ },
  onStepFinish: ({ stepType, toolCalls, toolResults, text }) => {
    console.log('Step finished:', {
      type: stepType,
      toolsUsed: toolCalls?.map(t => t.toolName),
      text,
    });
  },
});
```

### onFinish - Final Result

```typescript
const result = streamText({
  model: openai('gpt-5'),
  messages,
  onFinish: ({ text, toolCalls, toolResults, usage, finishReason }) => {
    console.log('Finished:', {
      text,
      toolsUsed: toolCalls.length,
      tokens: usage.totalTokens,
      reason: finishReason,
    });

    // Log to database, analytics, etc.
  },
});
```

## Error Handling

### Try-Catch Pattern

```typescript
export async function POST(req: Request) {
  try {
    const { messages } = await req.json();

    const result = streamText({
      model: openai('gpt-5'),
      messages,
    });

    return result.toDataStreamResponse();
  } catch (error) {
    console.error('Stream error:', error);

    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
```

### Error Callback

```typescript
const result = streamText({
  model: openai('gpt-5'),
  messages,
  onError: (error) => {
    console.error('Generation error:', error);

    // Log to error tracking
    logError(error);

    // Still throws error, but logged first
  },
});
```

## Advanced Features

### Control Tool Calling Loops

```typescript
const result = streamText({
  model: openai('gpt-5'),
  messages,
  tools: { /* ... */ },

  // Maximum steps (each tool call = 1 step)
  maxSteps: 5,

  // Stop when condition is met
  stopWhen: ({ toolCalls }) => {
    // Stop if agent calls 'done' tool
    return toolCalls?.some(t => t.toolName === 'done');
  },
});
```

### Custom Model Settings

```typescript
const result = streamText({
  model: openai('gpt-5', {
    // Override model settings
    temperature: 0.7,
    maxTokens: 2000,
    topP: 0.9,
  }),
  messages,
});
```

### Abort Controller

```typescript
const abortController = new AbortController();

const result = streamText({
  model: openai('gpt-5'),
  messages,
  abortSignal: abortController.signal,
});

// Cancel generation
abortController.abort();
```

## Response Formats

### Data Stream Response (Default)

```typescript
return result.toDataStreamResponse();
```

This returns a streaming response that `useChat` can consume directly.

### Text Stream Response

```typescript
return result.toTextStreamResponse();
```

Returns plain text stream (no tool calls or metadata).

### Custom Response

```typescript
const stream = result.textStream;

return new Response(stream, {
  headers: {
    'Content-Type': 'text/plain',
    'Cache-Control': 'no-cache',
  },
});
```

## Consuming Results Server-Side

### Get Full Text

```typescript
const result = streamText({
  model: openai('gpt-5'),
  prompt: 'Write a poem',
});

const text = await result.text;
console.log(text);
```

### Iterate Stream

```typescript
const result = streamText({
  model: openai('gpt-5'),
  prompt: 'Count to 10',
});

for await (const chunk of result.textStream) {
  console.log(chunk);
}
```

### Get Tool Results

```typescript
const result = streamText({
  model: openai('gpt-5'),
  messages,
  tools: { /* ... */ },
});

const toolResults = await result.toolResults;
console.log('Tools used:', toolResults);
```

## Best Practices

### 1. Always Use System Prompts

```typescript
const result = streamText({
  model: openai('gpt-5'),
  system: 'Clear instructions about your agent\'s role and behavior',
  messages,
});
```

### 2. Set maxSteps for Tool Calling

```typescript
const result = streamText({
  model: openai('gpt-5'),
  messages,
  tools: { /* ... */ },
  maxSteps: 10, // Prevent infinite loops
});
```

### 3. Use onStepFinish for Observability

```typescript
const result = streamText({
  model: openai('gpt-5'),
  messages,
  tools: { /* ... */ },
  onStepFinish: (step) => {
    // Log every step for debugging
    console.log('[Step]', step);
  },
});
```

### 4. Handle Errors Gracefully

```typescript
try {
  const result = streamText({ /* ... */ });
  return result.toDataStreamResponse();
} catch (error) {
  return new Response(
    JSON.stringify({ error: 'Something went wrong' }),
    { status: 500 }
  );
}
```

### 5. Validate Input

```typescript
export async function POST(req: Request) {
  const body = await req.json();

  if (!body.messages || !Array.isArray(body.messages)) {
    return new Response('Invalid request', { status: 400 });
  }

  const result = streamText({
    model: openai('gpt-5'),
    messages: body.messages,
  });

  return result.toDataStreamResponse();
}
```

## Debugging

### Log All Events

```typescript
const result = streamText({
  model: openai('gpt-5'),
  messages,
  tools: { /* ... */ },

  onChunk: ({ chunk }) => {
    console.log('[Chunk]', chunk);
  },

  onStepFinish: (step) => {
    console.log('[Step Finish]', step);
  },

  onFinish: (final) => {
    console.log('[Finish]', final);
  },
});
```

### Check Response in Browser

Open DevTools → Network → Find your API request → Preview/Response tab to see the streaming data.

## Performance Tips

1. **Use streaming** - Don't wait for full response
2. **Set reasonable maxTokens** - Limit response length
3. **Cache system prompts** - Reuse prompt text
4. **Use temperature = 0** - For deterministic outputs
5. **Limit maxSteps** - Prevent runaway tool calling

## Next Steps

- **Tools**: See `05-tool-calling.md` for tool definitions
- **Agents**: See `07-agents.md` for multi-step workflows
- **OpenAI**: See `06-openai-provider.md` for GPT-5 setup
