# Tool Calling - Enable LLM Actions

## Overview

Tools allow LLMs to perform actions like calling APIs, querying databases, or executing custom logic. The AI SDK makes tool calling type-safe and easy.

## Basic Tool Definition

```typescript
import { tool } from 'ai';
import { z } from 'zod';

const weatherTool = tool({
  description: 'Get the weather in a location',
  parameters: z.object({
    location: z.string().describe('The city name'),
  }),
  execute: async ({ location }) => {
    // Call weather API
    const weather = await getWeatherAPI(location);
    return weather;
  },
});
```

## Tool Structure

```typescript
const myTool = tool({
  // What this tool does (shown to LLM)
  description: string,

  // Input schema (Zod schema)
  parameters: ZodSchema,

  // Function to execute
  execute: async (params) => {
    // Do work
    return result;
  },
});
```

## Using Tools with streamText

```typescript
import { streamText, tool } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';

export async function POST(req: Request) {
  const { messages } = await req.json();

  const result = streamText({
    model: openai('gpt-5'),
    messages,
    tools: {
      getWeather: tool({
        description: 'Get weather for a city',
        parameters: z.object({
          city: z.string(),
        }),
        execute: async ({ city }) => {
          return { city, temp: 72, condition: 'Sunny' };
        },
      }),

      searchWeb: tool({
        description: 'Search the web',
        parameters: z.object({
          query: z.string(),
        }),
        execute: async ({ query }) => {
          // Search implementation
          return { results: [] };
        },
      }),
    },
  });

  return result.toDataStreamResponse();
}
```

## Podio Tool Examples

### Discovery Tools

```typescript
const podioTools = {
  listOrganizations: tool({
    description: 'List all Podio organizations the user has access to',
    parameters: z.object({}), // No parameters
    execute: async () => {
      const orgs = await podioClient.get('/org/');
      return {
        organizations: orgs.map(o => ({
          id: o.org_id,
          name: o.name,
          role: o.role,
        })),
      };
    },
  }),

  listSpaces: tool({
    description: 'List all spaces in a Podio organization',
    parameters: z.object({
      orgId: z.number().describe('The organization ID'),
    }),
    execute: async ({ orgId }) => {
      const spaces = await podioClient.get(`/space/org/${orgId}/`);
      return { spaces };
    },
  }),

  getApp: tool({
    description: 'Get detailed structure of a Podio app including fields',
    parameters: z.object({
      appId: z.number().describe('The app ID'),
    }),
    execute: async ({ appId }) => {
      const app = await podioClient.get(`/app/${appId}`);
      return {
        appId: app.app_id,
        name: app.config.name,
        fields: app.fields.map(f => ({
          fieldId: f.field_id,
          type: f.type,
          label: f.label,
          externalId: f.external_id,
        })),
      };
    },
  }),

  getAppFlows: tool({
    description: 'Get all Flows (automation workflows) for a Podio app',
    parameters: z.object({
      appId: z.number().describe('The app ID'),
    }),
    execute: async ({ appId }) => {
      const flows = await podioClient.get(`/flow/app/${appId}/`);
      return { flows };
    },
  }),

  getAppHooks: tool({
    description: 'Get all webhooks configured for a Podio app',
    parameters: z.object({
      appId: z.number().describe('The app ID'),
    }),
    execute: async ({ appId }) => {
      const hooks = await podioClient.get(`/hook/app/${appId}/`);
      return { hooks };
    },
  }),
};
```

### Migration Tools

```typescript
const migrationTools = {
  createSpace: tool({
    description: 'Create a new Podio space in an organization',
    parameters: z.object({
      orgId: z.number().describe('Organization ID'),
      name: z.string().describe('Space name'),
      privacy: z.enum(['open', 'closed']).default('closed'),
    }),
    execute: async ({ orgId, name, privacy }) => {
      const space = await podioClient.post('/space/', {
        org_id: orgId,
        name,
        privacy,
      });
      return { spaceId: space.space_id, name: space.name };
    },
  }),

  cloneApp: tool({
    description: 'Clone a Podio app to a target space, preserving structure',
    parameters: z.object({
      sourceAppId: z.number().describe('Source app ID to clone'),
      targetSpaceId: z.number().describe('Target space ID'),
    }),
    execute: async ({ sourceAppId, targetSpaceId }) => {
      // Get source app
      const sourceApp = await podioClient.get(`/app/${sourceAppId}`);

      // Create clone
      const targetApp = await podioClient.post(
        `/app/space/${targetSpaceId}/`,
        {
          config: sourceApp.config,
          fields: sourceApp.fields.map(f => ({
            type: f.type,
            external_id: f.external_id,
            config: f.config,
          })),
        }
      );

      return {
        sourceAppId,
        targetAppId: targetApp.app_id,
        name: targetApp.config.name,
      };
    },
  }),

  cloneFlow: tool({
    description: 'Clone a Podio Flow (automation) to a target app',
    parameters: z.object({
      sourceFlowId: z.number().describe('Source flow ID'),
      targetAppId: z.number().describe('Target app ID'),
    }),
    execute: async ({ sourceFlowId, targetAppId }) => {
      // Get source flow
      const flow = await podioClient.get(`/flow/${sourceFlowId}`);

      // Create in target
      const newFlow = await podioClient.post(`/flow/app/${targetAppId}/`, {
        type: flow.type,
        name: flow.name,
        effects: flow.effects,
      });

      return {
        sourceFlowId,
        targetFlowId: newFlow.flow_id,
        name: newFlow.name,
      };
    },
  }),
};
```

## Parameter Schemas with Zod

### Simple Parameters

```typescript
parameters: z.object({
  name: z.string(),
  age: z.number(),
  active: z.boolean(),
})
```

### With Descriptions

```typescript
parameters: z.object({
  appId: z.number().describe('The Podio app ID'),
  includeFields: z.boolean().describe('Include field details').default(true),
})
```

### Optional Parameters

```typescript
parameters: z.object({
  required: z.string(),
  optional: z.string().optional(),
  withDefault: z.number().default(10),
})
```

### Enums

```typescript
parameters: z.object({
  status: z.enum(['active', 'inactive', 'pending']),
  privacy: z.enum(['open', 'closed']).default('closed'),
})
```

### Arrays

```typescript
parameters: z.object({
  appIds: z.array(z.number()),
  tags: z.array(z.string()).optional(),
})
```

### Nested Objects

```typescript
parameters: z.object({
  source: z.object({
    orgId: z.number(),
    spaceId: z.number(),
  }),
  target: z.object({
    orgId: z.number(),
    spaceId: z.number(),
  }),
})
```

## Tool Execution

### Async Operations

Tools can be async (most should be):

```typescript
execute: async ({ city }) => {
  const weather = await fetch(`/api/weather?city=${city}`);
  return await weather.json();
}
```

### Error Handling in Tools

```typescript
execute: async ({ appId }) => {
  try {
    const app = await podioClient.get(`/app/${appId}`);
    return { success: true, app };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
}
```

### Long-Running Operations

```typescript
execute: async ({ sourceSpaceId, targetSpaceId }) => {
  // This might take a while
  const apps = await podioClient.get(`/app/space/${sourceSpaceId}/`);

  const results = [];
  for (const app of apps) {
    const cloned = await cloneAppToSpace(app, targetSpaceId);
    results.push(cloned);
  }

  return { migrated: results.length, apps: results };
}
```

## Multi-Step Tool Calling

The LLM can call multiple tools in sequence:

```typescript
const result = streamText({
  model: openai('gpt-5'),
  messages: [
    { role: 'user', content: 'Migrate workspace X to workspace Y' },
  ],
  tools: podioTools,
  maxSteps: 10, // Allow up to 10 tool calls
});

// LLM might:
// 1. Call listOrganizations
// 2. Call listSpaces (for source org)
// 3. Call listSpaces (for target org)
// 4. Call getApp (for each app in source)
// 5. Call cloneApp (for each app)
// 6. Call cloneFlow (for each flow)
```

## Controlling Tool Loops

### Stop After Specific Tool

```typescript
const result = streamText({
  model: openai('gpt-5'),
  messages,
  tools: {
    done: tool({
      description: 'Call this when migration is complete',
      parameters: z.object({
        summary: z.string(),
      }),
      execute: async ({ summary }) => {
        return { completed: true, summary };
      },
    }),
    // ... other tools
  },
  stopWhen: ({ toolCalls }) => {
    return toolCalls?.some(t => t.toolName === 'done');
  },
});
```

### Limit Steps

```typescript
const result = streamText({
  model: openai('gpt-5'),
  messages,
  tools: podioTools,
  maxSteps: 5, // Stop after 5 tool calls
});
```

## Tool Results in UI

Tool invocations appear in message objects:

```typescript
{
  id: 'msg-123',
  role: 'assistant',
  content: 'I found 3 organizations...',
  toolInvocations: [
    {
      state: 'result',
      toolCallId: 'call-abc',
      toolName: 'listOrganizations',
      args: {},
      result: {
        organizations: [/* ... */]
      }
    }
  ]
}
```

Display in UI:

```typescript
{message.toolInvocations?.map((tool, idx) => (
  <div key={idx} className="tool-call">
    <div className="tool-name">🔧 {tool.toolName}</div>
    <div className="tool-args">
      {JSON.stringify(tool.args, null, 2)}
    </div>
    {tool.result && (
      <div className="tool-result">
        ✓ {JSON.stringify(tool.result, null, 2)}
      </div>
    )}
  </div>
))}
```

## Callbacks for Observability

### onStepFinish

See each tool call as it completes:

```typescript
const result = streamText({
  model: openai('gpt-5'),
  messages,
  tools: podioTools,
  onStepFinish: ({ stepType, toolCalls, toolResults }) => {
    console.log('Step:', stepType);
    toolCalls?.forEach(call => {
      console.log(`  Tool: ${call.toolName}`, call.args);
    });
    toolResults?.forEach(result => {
      console.log(`  Result:`, result.result);
    });
  },
});
```

### onFinish

Summary at the end:

```typescript
onFinish: ({ text, toolCalls, toolResults, usage }) => {
  console.log('Finished:', {
    response: text,
    toolsUsed: toolCalls.map(t => t.toolName),
    totalTokens: usage.totalTokens,
  });
}
```

## Best Practices

### 1. Clear Descriptions

```typescript
// Good
description: 'Get all Podio apps in a specific space by space ID'

// Bad
description: 'Get apps'
```

### 2. Descriptive Parameters

```typescript
parameters: z.object({
  appId: z.number().describe('The Podio app ID to clone'),
  targetSpaceId: z.number().describe('The destination space ID'),
})
```

### 3. Return Structured Data

```typescript
// Good - structured
execute: async ({ appId }) => {
  const app = await getApp(appId);
  return {
    appId: app.app_id,
    name: app.config.name,
    fieldCount: app.fields.length,
  };
}

// Bad - just raw data
execute: async ({ appId }) => {
  return await getApp(appId);
}
```

### 4. Handle Errors Gracefully

```typescript
execute: async ({ appId }) => {
  try {
    const app = await podioClient.get(`/app/${appId}`);
    return { success: true, app };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      appId, // Include context
    };
  }
}
```

### 5. Add Confirmation for Destructive Actions

```typescript
const deleteApp = tool({
  description: 'Delete a Podio app (DESTRUCTIVE - use with caution)',
  parameters: z.object({
    appId: z.number(),
    confirm: z.literal(true).describe('Must be true to confirm deletion'),
  }),
  execute: async ({ appId, confirm }) => {
    if (!confirm) {
      return { error: 'Confirmation required' };
    }
    await podioClient.delete(`/app/${appId}`);
    return { deleted: true, appId };
  },
});
```

## Complete Podio Tools Example

```typescript
// lib/ai/podio-tools.ts
import { tool } from 'ai';
import { z } from 'zod';
import { podioClient } from '../podio/client';

export const podioTools = {
  // Discovery
  listOrganizations: tool({
    description: 'List all Podio organizations',
    parameters: z.object({}),
    execute: async () => {
      const orgs = await podioClient.get('/org/');
      return { organizations: orgs };
    },
  }),

  listSpaces: tool({
    description: 'List spaces in an organization',
    parameters: z.object({
      orgId: z.number(),
    }),
    execute: async ({ orgId }) => {
      const spaces = await podioClient.get(`/space/org/${orgId}/`);
      return { spaces };
    },
  }),

  getApp: tool({
    description: 'Get app structure',
    parameters: z.object({
      appId: z.number(),
    }),
    execute: async ({ appId }) => {
      const app = await podioClient.get(`/app/${appId}`);
      return { app };
    },
  }),

  // Migration
  cloneApp: tool({
    description: 'Clone app to target space',
    parameters: z.object({
      sourceAppId: z.number(),
      targetSpaceId: z.number(),
    }),
    execute: async ({ sourceAppId, targetSpaceId }) => {
      // Implementation
      const result = await cloneAppLogic(sourceAppId, targetSpaceId);
      return result;
    },
  }),

  // Validation
  validateMigration: tool({
    description: 'Validate migration was successful',
    parameters: z.object({
      sourceAppId: z.number(),
      targetAppId: z.number(),
    }),
    execute: async ({ sourceAppId, targetAppId }) => {
      // Compare structures
      const validation = await validateAppStructure(sourceAppId, targetAppId);
      return validation;
    },
  }),
};
```

## Next Steps

- **Agents**: See `07-agents.md` for orchestrating tools
- **API**: See `04-streamtext-api.md` for backend setup
- **UI**: See `03-chat-interface.md` for displaying tool calls
