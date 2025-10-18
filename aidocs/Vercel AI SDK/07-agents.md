# Building AI Agents

## Overview

An agent is an LLM that can:
1. Reason about a task
2. Use tools to gather information or take actions
3. Make decisions based on results
4. Continue until the task is complete

The AI SDK makes building agents simple with built-in tool calling loops.

## Basic Agent Pattern

```typescript
const result = streamText({
  model: openai('gpt-5'),
  system: 'You are a helpful assistant.',
  messages,
  tools: {
    // Tools the agent can use
    getTool1: tool({ /* ... */ }),
    getTool2: tool({ /* ... */ }),
  },
  maxSteps: 5, // Allow multi-step reasoning
});
```

## Multi-Step Workflows

The agent can call multiple tools in sequence to complete complex tasks.

### Example: Podio Migration

**User**: "Migrate all apps from Space A to Space B"

**Agent's Steps**:
1. Call `getSpaceApps(spaceA)` - discover apps
2. For each app:
   - Call `getAppStructure(appId)` - get details
   - Call `cloneApp(appId, spaceB)` - create copy
   - Call `getAppFlows(appId)` - get workflows
   - Call `cloneFlow(flowId, newAppId)` - copy workflows
3. Call `validateMigration()` - verify success
4. Respond to user with summary

## Controlling Agent Behavior

### maxSteps - Prevent Infinite Loops

```typescript
const result = streamText({
  model: openai('gpt-5'),
  messages,
  tools: podioTools,
  maxSteps: 10, // Stop after 10 tool calls
});
```

**When to use**:
- Always set for agents with tools
- Higher for complex workflows (10-20)
- Lower for simple tasks (3-5)

### stopWhen - Conditional Stopping

```typescript
const result = streamText({
  model: openai('gpt-5'),
  messages,
  tools: {
    done: tool({
      description: 'Call when task is complete',
      parameters: z.object({
        summary: z.string(),
      }),
      execute: async ({ summary }) => ({ summary }),
    }),
    // ... other tools
  },
  stopWhen: ({ toolCalls }) => {
    // Stop when 'done' tool is called
    return toolCalls?.some(t => t.toolName === 'done');
  },
});
```

### prepareStep - Dynamic Adjustments

```typescript
const result = streamText({
  model: openai('gpt-5'),
  messages,
  tools: podioTools,
  prepareStep: ({ step }) => {
    // Adjust model settings per step
    if (step > 5) {
      return {
        temperature: 0, // More deterministic as we get deeper
      };
    }
  },
});
```

## Agent Patterns

### Pattern 1: Sequential Discovery

Agent gathers information step-by-step.

```typescript
const result = streamText({
  model: openai('gpt-5'),
  system: `You are a Podio workspace analyzer.

First, list organizations.
Then, for the selected org, list spaces.
Then, for the selected space, list apps.
Finally, summarize the structure.`,
  messages,
  tools: {
    listOrgs: tool({ /* ... */ }),
    listSpaces: tool({ /* ... */ }),
    listApps: tool({ /* ... */ }),
  },
  maxSteps: 10,
});
```

### Pattern 2: Parallel Actions

Agent performs multiple independent actions.

```typescript
const result = streamText({
  model: openai('gpt-5'),
  system: 'Clone all apps in parallel.',
  messages,
  tools: {
    cloneApp: tool({
      description: 'Clone a single app',
      parameters: z.object({
        appId: z.number(),
        targetSpaceId: z.number(),
      }),
      execute: async ({ appId, targetSpaceId }) => {
        // This can be called multiple times in parallel
        return await cloneAppLogic(appId, targetSpaceId);
      },
    }),
  },
  maxSteps: 20, // Allow many parallel clones
});
```

### Pattern 3: Validation Loop

Agent checks results and retries if needed.

```typescript
const result = streamText({
  model: openai('gpt-5'),
  system: `Clone the app, then validate.
  If validation fails, try to fix and validate again.`,
  messages,
  tools: {
    cloneApp: tool({ /* ... */ }),
    validateApp: tool({
      description: 'Check if app was cloned correctly',
      parameters: z.object({
        sourceAppId: z.number(),
        targetAppId: z.number(),
      }),
      execute: async ({ sourceAppId, targetAppId }) => {
        const validation = await compareApps(sourceAppId, targetAppId);
        return {
          valid: validation.isValid,
          errors: validation.errors,
        };
      },
    }),
    fixApp: tool({ /* ... */ }),
  },
  maxSteps: 15,
});
```

## System Prompts for Agents

Good system prompts guide agent behavior.

### Podio Migration Agent Example

```typescript
const systemPrompt = `You are a Podio workflow migration assistant.

Your capabilities:
- List and explore Podio organizations, spaces, and apps
- Clone app structures between spaces
- Migrate Flows (automation) and Hooks (webhooks)
- Validate migrations

Guidelines:
1. Always confirm before making changes
2. Explain what you're doing at each step
3. If something fails, explain why and suggest alternatives
4. Summarize results at the end

Important:
- NEVER delete anything without explicit confirmation
- ALWAYS validate migrations after completion
- Be transparent about limitations

When asked to migrate:
1. First, discover source structure
2. Confirm target location
3. Clone apps in dependency order
4. Migrate workflows
5. Validate everything
6. Provide summary`;

const result = streamText({
  model: openai('gpt-5'),
  system: systemPrompt,
  messages,
  tools: podioTools,
  maxSteps: 20,
});
```

### Principles for Good System Prompts

1. **Clear Role**: "You are a [specific role]"
2. **Capabilities**: List what the agent can do
3. **Guidelines**: How to behave
4. **Constraints**: What NOT to do
5. **Process**: Step-by-step workflow

## Observability

### Track Each Step

```typescript
const result = streamText({
  model: openai('gpt-5'),
  messages,
  tools: podioTools,
  onStepFinish: ({ stepType, toolCalls, toolResults, text }) => {
    console.log(`[Step ${stepType}]`);

    if (toolCalls) {
      toolCalls.forEach(call => {
        console.log(`  🔧 ${call.toolName}(${JSON.stringify(call.args)})`);
      });
    }

    if (toolResults) {
      toolResults.forEach(result => {
        console.log(`  ✓ Result:`, result.result);
      });
    }

    if (text) {
      console.log(`  💬 Response: ${text}`);
    }
  },
});
```

### Track Completion

```typescript
onFinish: ({ text, toolCalls, toolResults, usage, finishReason }) => {
  console.log('Agent finished:', {
    reason: finishReason,
    totalSteps: toolCalls.length,
    toolsUsed: toolCalls.map(t => t.toolName),
    tokensUsed: usage.totalTokens,
  });
}
```

## Complete Podio Agent Example

```typescript
// app/api/agent/route.ts
import { streamText, tool } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import { podioClient } from '@/lib/podio/client';

const podioSystemPrompt = `You are a Podio workflow migration expert.

Your role:
- Help users migrate Globiflow workflows between Podio workspaces
- Provide clear explanations of what you're doing
- Confirm before destructive actions
- Validate migrations thoroughly

Process for migrations:
1. Discover source workspace structure
2. Identify target workspace
3. Clone apps (preserving field structure)
4. Migrate Flows and Hooks
5. Validate everything worked
6. Provide detailed summary

Always be transparent and explain your reasoning.`;

export async function POST(req: Request) {
  const { messages } = await req.json();

  const result = streamText({
    model: openai('gpt-5', {
      temperature: 0, // Deterministic for tool calling
    }),
    system: podioSystemPrompt,
    messages,
    maxSteps: 20,

    tools: {
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
          orgId: z.number().describe('Organization ID'),
        }),
        execute: async ({ orgId }) => {
          const spaces = await podioClient.get(`/space/org/${orgId}/`);
          return { spaces };
        },
      }),

      getSpaceApps: tool({
        description: 'Get all apps in a space',
        parameters: z.object({
          spaceId: z.number().describe('Space ID'),
        }),
        execute: async ({ spaceId }) => {
          const apps = await podioClient.get(`/app/space/${spaceId}/`);
          return { apps };
        },
      }),

      getAppStructure: tool({
        description: 'Get detailed app structure including fields',
        parameters: z.object({
          appId: z.number().describe('App ID'),
        }),
        execute: async ({ appId }) => {
          const app = await podioClient.get(`/app/${appId}`);
          return {
            appId: app.app_id,
            name: app.config.name,
            fields: app.fields,
          };
        },
      }),

      getAppFlows: tool({
        description: 'Get Flows (automation) for an app',
        parameters: z.object({
          appId: z.number().describe('App ID'),
        }),
        execute: async ({ appId }) => {
          const flows = await podioClient.get(`/flow/app/${appId}/`);
          return { flows };
        },
      }),

      // Migration
      cloneApp: tool({
        description: 'Clone app structure to target space',
        parameters: z.object({
          sourceAppId: z.number().describe('Source app ID'),
          targetSpaceId: z.number().describe('Target space ID'),
        }),
        execute: async ({ sourceAppId, targetSpaceId }) => {
          // Get source app
          const sourceApp = await podioClient.get(`/app/${sourceAppId}`);

          // Create in target
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
            success: true,
            sourceAppId,
            targetAppId: targetApp.app_id,
            name: targetApp.config.name,
          };
        },
      }),

      cloneFlow: tool({
        description: 'Clone a Flow to target app',
        parameters: z.object({
          sourceFlowId: z.number().describe('Source flow ID'),
          targetAppId: z.number().describe('Target app ID'),
        }),
        execute: async ({ sourceFlowId, targetAppId }) => {
          const flow = await podioClient.get(`/flow/${sourceFlowId}`);

          const newFlow = await podioClient.post(`/flow/app/${targetAppId}/`, {
            type: flow.type,
            name: flow.name,
            effects: flow.effects,
          });

          return {
            success: true,
            sourceFlowId,
            targetFlowId: newFlow.flow_id,
            name: newFlow.name,
          };
        },
      }),

      // Validation
      validateMigration: tool({
        description: 'Validate that migration was successful',
        parameters: z.object({
          sourceAppId: z.number(),
          targetAppId: z.number(),
        }),
        execute: async ({ sourceAppId, targetAppId }) => {
          const [sourceApp, targetApp] = await Promise.all([
            podioClient.get(`/app/${sourceAppId}`),
            podioClient.get(`/app/${targetAppId}`),
          ]);

          const validation = {
            fieldsMatch: sourceApp.fields.length === targetApp.fields.length,
            namesMatch: sourceApp.config.name === targetApp.config.name,
            sourceFieldCount: sourceApp.fields.length,
            targetFieldCount: targetApp.fields.length,
          };

          return {
            valid: validation.fieldsMatch && validation.namesMatch,
            details: validation,
          };
        },
      }),
    },

    // Observability
    onStepFinish: ({ stepType, toolCalls, text }) => {
      console.log(`[Agent Step: ${stepType}]`);
      if (toolCalls) {
        toolCalls.forEach(call => {
          console.log(`  Tool: ${call.toolName}`, call.args);
        });
      }
    },

    onFinish: ({ text, toolCalls, usage, finishReason }) => {
      console.log('[Agent Finished]', {
        reason: finishReason,
        steps: toolCalls.length,
        tokens: usage.totalTokens,
      });
    },
  });

  return result.toDataStreamResponse();
}
```

## Best Practices

### 1. Always Set maxSteps

```typescript
// ✅ Good
maxSteps: 10

// ❌ Bad - could loop forever
// (no maxSteps)
```

### 2. Write Clear System Prompts

```typescript
// ✅ Good
system: `You are a Podio migration assistant.
Steps:
1. Discover source
2. Clone to target
3. Validate
Always confirm before changes.`

// ❌ Bad
system: 'You help with Podio'
```

### 3. Use temperature: 0 for Agents

```typescript
// ✅ Good - deterministic tool calling
model: openai('gpt-5', { temperature: 0 })

// ❌ Bad - unpredictable
model: openai('gpt-5', { temperature: 1.5 })
```

### 4. Add Observability

```typescript
// ✅ Good
onStepFinish: (step) => console.log(step),
onFinish: (result) => console.log(result),

// ❌ Bad - no visibility
```

### 5. Handle Tool Errors

```typescript
execute: async ({ appId }) => {
  try {
    const app = await getApp(appId);
    return { success: true, app };
  } catch (error) {
    return { success: false, error: error.message };
  }
}
```

## Common Patterns

### Confirmation Before Destructive Actions

```typescript
const tools = {
  deleteApp: tool({
    description: 'Delete app (requires confirmation)',
    parameters: z.object({
      appId: z.number(),
      confirmed: z.literal(true).describe('Must be true'),
    }),
    execute: async ({ appId, confirmed }) => {
      if (!confirmed) {
        return { error: 'Confirmation required' };
      }
      await deleteApp(appId);
      return { deleted: true };
    },
  }),
};
```

### Progress Reporting

```typescript
execute: async ({ appIds, targetSpaceId }) => {
  const results = [];

  for (let i = 0; i < appIds.length; i++) {
    const result = await cloneApp(appIds[i], targetSpaceId);
    results.push(result);

    // Return progress
    if ((i + 1) % 5 === 0) {
      return {
        progress: true,
        completed: i + 1,
        total: appIds.length,
        partialResults: results,
      };
    }
  }

  return { completed: true, results };
}
```

### Dependency Resolution

```typescript
system: `When cloning apps:
1. Identify app reference fields
2. Clone apps in dependency order (referenced apps first)
3. Update app reference fields to point to new apps
4. Then clone workflows`
```

## Troubleshooting

### Agent Loops Forever
- Set `maxSteps`
- Add `stopWhen` condition
- Review system prompt for clarity

### Agent Doesn't Use Tools
- Check tool descriptions are clear
- Verify parameters match expectations
- Try temperature: 0

### Agent Makes Wrong Decisions
- Improve system prompt
- Add examples in prompt
- Use temperature: 0 for determinism

## Next Steps

- **Tools**: See `05-tool-calling.md` for tool details
- **API**: See `04-streamtext-api.md` for backend setup
- **UI**: See `03-chat-interface.md` for displaying agent work
