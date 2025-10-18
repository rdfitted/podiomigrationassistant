# OpenAI Provider & GPT-5 Setup

## Installation

```bash
npm install @ai-sdk/openai
```

## Basic Setup

```typescript
import { openai } from '@ai-sdk/openai';

const model = openai('gpt-5');
```

## Environment Variables

**`.env.local`**:
```bash
OPENAI_API_KEY=sk-your-api-key-here
```

The SDK automatically reads `OPENAI_API_KEY` from environment.

## Available Models

### Language Models (GPT-5 Family)

```typescript
// GPT-5 (default)
openai('gpt-5')

// GPT-5 Pro (higher capability)
openai('gpt-5-pro')

// GPT-5 Mini (faster, cheaper)
openai('gpt-5-mini')

// GPT-5 Nano (fastest, cheapest)
openai('gpt-5-nano')
```

### GPT-4 Models

```typescript
openai('gpt-4o')       // GPT-4 Omni
openai('gpt-4o-mini')  // GPT-4 Omni Mini
openai('gpt-4-turbo')  // GPT-4 Turbo
```

## Model Configuration

### Basic Config

```typescript
const model = openai('gpt-5', {
  temperature: 0.7,      // 0-2, randomness (default: 1)
  maxTokens: 2000,       // Max tokens to generate
  topP: 0.9,             // Nucleus sampling (default: 1)
  frequencyPenalty: 0.5, // Reduce repetition (0-2)
  presencePenalty: 0.5,  // Encourage new topics (0-2)
});
```

### For Agents (Recommended Settings)

```typescript
const agentModel = openai('gpt-5', {
  temperature: 0,        // Deterministic for tool calling
  maxTokens: 4000,       // Enough for complex responses
});
```

### For Creative Tasks

```typescript
const creativeModel = openai('gpt-5', {
  temperature: 1.2,      // More creative
  topP: 0.95,
});
```

## Custom OpenAI Configuration

### Custom API Key

```typescript
import { createOpenAI } from '@ai-sdk/openai';

const customOpenAI = createOpenAI({
  apiKey: 'custom-key',
  organization: 'org-123',
  project: 'proj-456',
});

const model = customOpenAI('gpt-5');
```

### Custom Base URL (Azure, etc.)

```typescript
const azureOpenAI = createOpenAI({
  apiKey: process.env.AZURE_OPENAI_KEY,
  baseURL: 'https://your-resource.openai.azure.com',
  organization: 'your-org',
});

const model = azureOpenAI('gpt-4');
```

### Custom Headers

```typescript
const customOpenAI = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  headers: {
    'X-Custom-Header': 'value',
  },
});
```

## Usage with streamText

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

## Model Selection Strategy

### For This Project (Podio Agent)

```typescript
// Use GPT-5 for main agent
const mainModel = openai('gpt-5', {
  temperature: 0, // Deterministic for tool calling
});

// Optional: Use GPT-5 Mini for simple queries
const fastModel = openai('gpt-5-mini', {
  temperature: 0,
});
```

### When to Use Each Model

**GPT-5**:
- Complex reasoning
- Multi-step workflows
- Tool calling agents
- **Best for Podio migration**

**GPT-5 Pro**:
- Most complex tasks
- Need highest accuracy
- Willing to pay premium

**GPT-5 Mini**:
- Simple queries
- Fast responses needed
- Cost-sensitive
- High volume

**GPT-5 Nano**:
- Very simple tasks
- Extremely cost-sensitive
- Ultra-low latency needed

## Temperature Guide

```typescript
// Deterministic (for tool calling, data extraction)
temperature: 0

// Slightly creative (for helpful responses)
temperature: 0.3

// Balanced (default)
temperature: 1

// Creative (for brainstorming, writing)
temperature: 1.5

// Very creative (for artistic content)
temperature: 2
```

## Token Limits

### GPT-5 Context Windows

- **GPT-5**: 128K tokens
- **GPT-5 Pro**: 128K tokens
- **GPT-5 Mini**: 128K tokens

### Setting Max Tokens

```typescript
const model = openai('gpt-5', {
  maxTokens: 2000, // Limit response length
});
```

**Tip**: 1 token ≈ 0.75 words, so 2000 tokens ≈ 1500 words

## Cost Optimization

### Use Cheaper Models When Possible

```typescript
// Simple task - use Mini
if (isSimpleQuery(query)) {
  model = openai('gpt-5-mini');
} else {
  model = openai('gpt-5');
}
```

### Limit Max Tokens

```typescript
const model = openai('gpt-5', {
  maxTokens: 1000, // Don't generate more than needed
});
```

### Use temperature: 0 for Consistency

```typescript
// More predictable, often shorter responses
const model = openai('gpt-5', {
  temperature: 0,
});
```

## Error Handling

### API Key Errors

```typescript
try {
  const result = streamText({
    model: openai('gpt-5'),
    prompt: 'Hello',
  });
} catch (error) {
  if (error.code === 'invalid_api_key') {
    console.error('Check your OPENAI_API_KEY');
  }
}
```

### Rate Limits

```typescript
try {
  const result = streamText({ /* ... */ });
} catch (error) {
  if (error.code === 'rate_limit_exceeded') {
    // Wait and retry
    await sleep(1000);
    // retry...
  }
}
```

### Model Not Found

```typescript
try {
  const model = openai('gpt-5');
} catch (error) {
  if (error.code === 'model_not_found') {
    console.error('Model not available');
  }
}
```

## Podio Agent Configuration

**Recommended setup for this project**:

```typescript
// lib/ai/models.ts
import { openai } from '@ai-sdk/openai';

export const podioAgentModel = openai('gpt-5', {
  // Deterministic for tool calling
  temperature: 0,

  // Enough for complex responses
  maxTokens: 4000,

  // Standard settings
  topP: 1,
  frequencyPenalty: 0,
  presencePenalty: 0,
});
```

**Usage**:

```typescript
import { streamText } from 'ai';
import { podioAgentModel } from '@/lib/ai/models';

export async function POST(req: Request) {
  const { messages } = await req.json();

  const result = streamText({
    model: podioAgentModel,
    messages,
    tools: podioTools,
  });

  return result.toDataStreamResponse();
}
```

## Advanced Features

### Streaming

Enabled by default with `streamText`:

```typescript
const result = streamText({
  model: openai('gpt-5'),
  prompt: 'Count to 100',
});

for await (const chunk of result.textStream) {
  console.log(chunk);
}
```

### Tool Calling

GPT-5 has excellent tool calling:

```typescript
const result = streamText({
  model: openai('gpt-5'),
  messages,
  tools: {
    getPodioApps: tool({ /* ... */ }),
  },
});
```

### Structured Output

```typescript
import { generateObject } from 'ai';

const result = await generateObject({
  model: openai('gpt-5'),
  schema: z.object({
    apps: z.array(z.object({
      id: z.number(),
      name: z.string(),
    })),
  }),
  prompt: 'List Podio apps',
});
```

## Monitoring & Debugging

### Log Token Usage

```typescript
const result = streamText({
  model: openai('gpt-5'),
  messages,
  onFinish: ({ usage }) => {
    console.log('Tokens:', {
      prompt: usage.promptTokens,
      completion: usage.completionTokens,
      total: usage.totalTokens,
    });
  },
});
```

### Track Costs

```typescript
// GPT-5 pricing (example - check current rates)
const COST_PER_1K_INPUT = 0.015;  // $0.015 per 1K tokens
const COST_PER_1K_OUTPUT = 0.06;  // $0.06 per 1K tokens

onFinish: ({ usage }) => {
  const cost =
    (usage.promptTokens / 1000) * COST_PER_1K_INPUT +
    (usage.completionTokens / 1000) * COST_PER_1K_OUTPUT;

  console.log(`Cost: $${cost.toFixed(4)}`);
}
```

## Best Practices

### 1. Use Environment Variables

```typescript
// ✅ Good
const model = openai('gpt-5'); // Uses OPENAI_API_KEY from env

// ❌ Bad
const model = openai('gpt-5', { apiKey: 'hardcoded-key' });
```

### 2. Set temperature: 0 for Agents

```typescript
// ✅ Good for tool calling
const model = openai('gpt-5', { temperature: 0 });

// ❌ High temperature makes tool calling unpredictable
const model = openai('gpt-5', { temperature: 1.5 });
```

### 3. Limit Max Tokens

```typescript
// ✅ Good - prevent runaway costs
const model = openai('gpt-5', { maxTokens: 2000 });

// ❌ No limit - could be expensive
const model = openai('gpt-5');
```

### 4. Handle Errors

```typescript
try {
  const result = streamText({ model: openai('gpt-5'), messages });
  return result.toDataStreamResponse();
} catch (error) {
  console.error('OpenAI error:', error);
  return new Response('Error', { status: 500 });
}
```

### 5. Monitor Usage

```typescript
const result = streamText({
  model: openai('gpt-5'),
  messages,
  onFinish: ({ usage }) => {
    // Log to analytics, database, etc.
    logUsage(usage);
  },
});
```

## Troubleshooting

### "Invalid API key"
- Check `.env.local` has `OPENAI_API_KEY`
- Restart dev server after adding key
- Verify key starts with `sk-`

### "Model not found"
- Check model name spelling: `openai('gpt-5')`
- Verify you have access to GPT-5
- Try `openai('gpt-4o')` as fallback

### Rate limits
- Implement exponential backoff
- Use cheaper models for high-volume tasks
- Contact OpenAI to increase limits

### Slow responses
- Use `gpt-5-mini` for faster responses
- Reduce `maxTokens`
- Enable streaming (already default)

## Quick Reference

```typescript
// Import
import { openai } from '@ai-sdk/openai';

// Basic model
const model = openai('gpt-5');

// Configured model
const model = openai('gpt-5', {
  temperature: 0,
  maxTokens: 2000,
});

// Use with streamText
const result = streamText({
  model: openai('gpt-5'),
  messages,
});

// Custom configuration
import { createOpenAI } from '@ai-sdk/openai';
const custom = createOpenAI({ apiKey: '...' });
const model = custom('gpt-5');
```

## Next Steps

- **Agents**: See `07-agents.md` for using GPT-5 in agents
- **Tools**: See `05-tool-calling.md` for tool calling
- **API**: See `04-streamtext-api.md` for backend setup
