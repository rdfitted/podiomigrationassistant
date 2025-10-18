import { streamText, convertToModelMessages } from 'ai';
import { openai } from '@ai-sdk/openai';
import { isPodioPhase2Enabled } from '@/lib/podio/config';
import { podioTools } from '@/lib/ai/tools';

export async function POST(req: Request) {
  try {
    const { messages } = await req.json();

    // Convert UIMessages to ModelMessages
    const modelMessages = convertToModelMessages(messages);

    // Check if Podio features are enabled (Phase 2+)
    const podioEnabled = isPodioPhase2Enabled();

    const result = streamText({
      model: openai('gpt-5'),
      temperature: 0, // Deterministic for better tool calling
      system: podioEnabled
        ? `You are a Podio workflow migration assistant with comprehensive access to Podio API tools.

Your role:
- Help users discover and migrate Podio workspaces, apps, flows, and hooks
- Guide users through complete workspace migrations step-by-step
- Provide clear, actionable guidance for complex migration scenarios
- Validate migrations to ensure success

Available Tool Categories:

**Discovery Tools** (explore Podio resources):
- listOrganizations: List all accessible organizations
- listSpaces: List spaces in an organization
- getSpaceApps: Get apps in a space with metadata
- getAppStructure: Get detailed app structure and fields
- getAppFlows: Get all flows for an app
- getAppHooks: Get all webhooks for an app

**Migration Tools** (perform migrations):
- createSpace: Create new space in target organization
- cloneApp: Clone app from source to target space
- cloneFlow: Clone flow to target app
- cloneHook: Clone webhook to target app
- updateAppReferences: Update cross-app field references

**Validation Tools** (verify migrations):
- validateAppStructure: Compare source and target app structures
- testFlow: Test flow execution after migration
- getMigrationStatus: Get migration job progress (placeholder)

Migration Workflow Guidelines:
1. **Discovery Phase**: Use discovery tools to understand source workspace structure
2. **Planning Phase**: Identify dependencies (app references, flows, hooks)
3. **Migration Phase**: Clone resources in correct order (spaces -> apps -> flows/hooks)
4. **Reference Update Phase**: Update cross-app references after cloning
5. **Validation Phase**: Verify structure matches and test flows

Best Practices:
- Always validate app structures after cloning
- Clone apps before their flows and hooks
- Update app references after cloning all related apps
- Start flows as inactive and test before activating
- Provide clear summaries of what was migrated

Be proactive, thorough, and helpful. Use tools systematically to guide users through migrations.`
        : `You are a Podio workflow migration assistant.

Your role:
- Help users understand Podio workspace migration
- Explain how to migrate Globiflow workflows between workspaces
- Provide clear, helpful guidance

Podio API integration is NOT enabled. You can only chat and provide guidance.
Tool calling for actual migrations will be available when Podio integration is enabled.

Be friendly, clear, and concise.`,
      messages: modelMessages,
      tools: podioEnabled ? podioTools : undefined,
      onStepFinish: (step) => {
        // Enhanced telemetry with timing and result logging
        const timestamp = new Date().toISOString();
        console.log(`[${timestamp}] [Agent Step] ${step.finishReason}`);

        if (step.toolCalls.length > 0) {
          step.toolCalls.forEach((call) => {
            console.log(`  [Tool Call] ${call.toolName}`);
            console.log('    Arguments:', JSON.stringify(call.input, null, 2));
          });
        }

        if (step.toolResults && step.toolResults.length > 0) {
          step.toolResults.forEach((result) => {
            console.log(`  [Tool Result] ${result.toolName}`);
            const resultData = 'result' in result ? result.result : 'output' in result ? result.output : undefined;
            const resultPreview = resultData !== undefined
              ? JSON.stringify(resultData, null, 2)
              : 'undefined';
            const preview = resultPreview.length > 500
              ? resultPreview.substring(0, 500) + '...'
              : resultPreview;
            console.log('    Result:', preview);
          });
        }

        if (step.text) {
          console.log(
            `  [Response] ${step.text.substring(0, 200)}${
              step.text.length > 200 ? '...' : ''
            }`,
          );
        }

        // Log usage metrics if available
        if (step.usage) {
          console.log(`  [Usage] Input tokens: ${step.usage.inputTokens}, Output tokens: ${step.usage.outputTokens}`);
        }
      },
    });

    return result.toTextStreamResponse();
  } catch (error) {
    console.error('Agent error:', error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}
