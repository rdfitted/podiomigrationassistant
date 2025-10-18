/**
 * Zod schemas for Podio API resources
 * These schemas validate tool inputs/outputs for the AI agent
 */

import { z } from 'zod';

/**
 * Organization schemas
 */
export const organizationSchema = z.object({
  org_id: z.number(),
  name: z.string(),
  url: z.string(),
  url_label: z.string().optional(),
  logo: z.number().optional(),
  image: z
    .object({
      link: z.string(),
      thumbnail_link: z.string().optional(),
    })
    .optional(),
  premium: z.boolean().optional(),
  role: z.string().optional(),
  status: z.string().optional(),
  type: z.string().optional(),
  user_limit: z.number().optional(),
  member_count: z.number().optional(),
  created_on: z.string().optional(),
});

export const listOrganizationsInputSchema = z.object({});

export const listOrganizationsOutputSchema = z.array(organizationSchema);

export const getOrganizationInputSchema = z.object({
  orgId: z.number().describe('Organization ID'),
});

export const getOrganizationOutputSchema = organizationSchema;

export const getOrganizationByUrlInputSchema = z.object({
  url: z.string().describe('Organization URL label'),
});

export const getOrganizationMembersInputSchema = z.object({
  orgId: z.number().describe('Organization ID'),
});

/**
 * Space schemas
 */
export const spaceSchema = z.object({
  space_id: z.number(),
  name: z.string(),
  url: z.string(),
  url_label: z.string().optional(),
  org_id: z.number(),
  privacy: z.enum(['open', 'closed']).optional(),
  auto_join: z.boolean().optional(),
  post_on_new_app: z.boolean().optional(),
  post_on_new_member: z.boolean().optional(),
  type: z.string().optional(),
  premium: z.boolean().optional(),
  role: z.string().optional(),
  rights: z.array(z.string()).optional(),
  created_on: z.string().optional(),
  created_by: z
    .object({
      user_id: z.number(),
      name: z.string(),
    })
    .optional(),
});

export const listSpacesInputSchema = z.object({
  orgId: z.number().describe('Organization ID'),
});

export const listSpacesOutputSchema = z.array(spaceSchema);

export const getSpaceInputSchema = z.object({
  spaceId: z.number().describe('Space ID'),
});

export const getSpaceOutputSchema = spaceSchema;

export const getSpaceByUrlInputSchema = z.object({
  url: z.string().describe('Space URL label'),
});

export const createSpaceInputSchema = z.object({
  orgId: z.number().describe('Organization ID'),
  name: z.string().describe('Space name'),
  privacy: z.enum(['open', 'closed']).optional().describe('Space privacy setting'),
  auto_join: z.boolean().optional().describe('Auto-join new members'),
  post_on_new_app: z.boolean().optional().describe('Post when new app is created'),
  post_on_new_member: z.boolean().optional().describe('Post when new member joins'),
});

export const createSpaceOutputSchema = z.object({
  space_id: z.number(),
});

export const updateSpaceInputSchema = z.object({
  spaceId: z.number().describe('Space ID'),
  name: z.string().optional().describe('Space name'),
  privacy: z.enum(['open', 'closed']).optional().describe('Space privacy setting'),
  auto_join: z.boolean().optional().describe('Auto-join new members'),
  post_on_new_app: z.boolean().optional().describe('Post when new app is created'),
  post_on_new_member: z.boolean().optional().describe('Post when new member joins'),
});


/**
 * Application field schemas
 */
export const appFieldSchema = z.object({
  field_id: z.number(),
  type: z.string(),
  external_id: z.string(),
  label: z.string(),
  config: z.object({
    label: z.string().optional(),
    description: z.string().optional(),
    required: z.boolean().optional(),
    unique: z.boolean().optional(),
    delta: z.number().optional(),
    hidden: z.boolean().optional(),
    settings: z.record(z.unknown()).optional(),
    referenced_apps: z
      .array(
        z.object({
          app_id: z.number(),
          view_id: z.number().optional(),
        })
      )
      .optional(),
  }),
  status: z.string().optional(),
});

/**
 * Application schemas
 */
export const applicationSchema = z.object({
  app_id: z.number(),
  status: z.string(),
  space_id: z.number(),
  config: z.object({
    name: z.string(),
    item_name: z.string().optional(),
    description: z.string().optional(),
    icon: z.string().optional(),
    icon_id: z.number().optional(),
    external_id: z.string().optional(),
    allow_edit: z.boolean().optional(),
    allow_create: z.boolean().optional(),
    default_view: z.string().optional(),
  }),
  fields: z.array(appFieldSchema).optional(),
  link: z.string().optional(),
  url_label: z.string().optional(),
  created_on: z.string().optional(),
  created_by: z
    .object({
      user_id: z.number(),
      name: z.string(),
    })
    .optional(),
});

export const listApplicationsInputSchema = z.object({
  spaceId: z.number().describe('Space ID'),
});

export const listApplicationsOutputSchema = z.array(applicationSchema);

export const getApplicationInputSchema = z.object({
  appId: z.number().describe('Application ID'),
});

export const getApplicationOutputSchema = applicationSchema;

export const getApplicationByUrlInputSchema = z.object({
  url: z.string().describe('Application URL label'),
});

export const createApplicationInputSchema = z.object({
  spaceId: z.number().describe('Space ID'),
  name: z.string().describe('Application name'),
  item_name: z.string().optional().describe('Singular item name'),
  description: z.string().optional().describe('Application description'),
  icon: z.string().optional().describe('Icon identifier'),
  external_id: z.string().optional().describe('External ID for reference'),
  allow_edit: z.boolean().optional().describe('Allow editing items'),
  allow_create: z.boolean().optional().describe('Allow creating items'),
  fields: z
    .array(
      z.object({
        type: z.string().describe('Field type'),
        label: z.string().describe('Field label'),
        description: z.string().optional().describe('Field description'),
        required: z.boolean().optional().describe('Is field required'),
        unique: z.boolean().optional().describe('Is field unique'),
        settings: z.record(z.unknown()).optional().describe('Field-specific settings'),
      })
    )
    .optional()
    .describe('Application fields'),
});

export const createApplicationOutputSchema = z.object({
  app_id: z.number(),
});

export const updateApplicationInputSchema = z.object({
  appId: z.number().describe('Application ID'),
  name: z.string().optional().describe('Application name'),
  item_name: z.string().optional().describe('Singular item name'),
  description: z.string().optional().describe('Application description'),
  icon: z.string().optional().describe('Icon identifier'),
  allow_edit: z.boolean().optional().describe('Allow editing items'),
  allow_create: z.boolean().optional().describe('Allow creating items'),
});


export const addApplicationFieldInputSchema = z.object({
  appId: z.number().describe('Application ID'),
  type: z.string().describe('Field type'),
  label: z.string().describe('Field label'),
  description: z.string().optional().describe('Field description'),
  required: z.boolean().optional().describe('Is field required'),
  unique: z.boolean().optional().describe('Is field unique'),
  settings: z.record(z.unknown()).optional().describe('Field-specific settings'),
});

export const addApplicationFieldOutputSchema = z.object({
  field_id: z.number(),
});

export const getApplicationFieldsInputSchema = z.object({
  appId: z.number().describe('Application ID'),
});

export const getApplicationFieldsOutputSchema = z.array(appFieldSchema);

/**
 * Flow schemas
 */
export const flowSchema = z.object({
  flow_id: z.string(),
  name: z.string(),
  app_id: z.number(),
  status: z.enum(['active', 'inactive']),
  type: z.string().optional(),
  trigger: z
    .object({
      type: z.string(),
      config: z.record(z.unknown()),
    })
    .optional(),
  actions: z
    .array(
      z.object({
        type: z.string(),
        config: z.record(z.unknown()),
      })
    )
    .optional(),
  conditions: z
    .array(
      z.object({
        type: z.string(),
        config: z.record(z.unknown()),
      })
    )
    .optional(),
  created_on: z.string().optional(),
  created_by: z
    .object({
      user_id: z.number(),
      name: z.string(),
    })
    .optional(),
});

export const listFlowsInputSchema = z.object({
  appId: z.number().describe('Application ID'),
});

export const listFlowsOutputSchema = z.array(flowSchema);

export const getFlowInputSchema = z.object({
  flowId: z.string().describe('Flow ID'),
});

export const getFlowOutputSchema = flowSchema;

export const createFlowInputSchema = z.object({
  appId: z.number().describe('Application ID'),
  name: z.string().describe('Flow name'),
  status: z.enum(['active', 'inactive']).optional().describe('Flow status'),
  type: z.string().optional().describe('Flow type'),
  trigger: z
    .object({
      type: z.string().describe('Trigger type'),
      config: z.record(z.unknown()).describe('Trigger configuration'),
    })
    .optional()
    .describe('Flow trigger'),
  actions: z
    .array(
      z.object({
        type: z.string().describe('Action type'),
        config: z.record(z.unknown()).describe('Action configuration'),
      })
    )
    .optional()
    .describe('Flow actions'),
  conditions: z
    .array(
      z.object({
        type: z.string().describe('Condition type'),
        config: z.record(z.unknown()).describe('Condition configuration'),
      })
    )
    .optional()
    .describe('Flow conditions'),
});

export const createFlowOutputSchema = z.object({
  flow_id: z.string(),
});

export const updateFlowInputSchema = z.object({
  flowId: z.string().describe('Flow ID'),
  name: z.string().optional().describe('Flow name'),
  status: z.enum(['active', 'inactive']).optional().describe('Flow status'),
  trigger: z
    .object({
      type: z.string().describe('Trigger type'),
      config: z.record(z.unknown()).describe('Trigger configuration'),
    })
    .optional()
    .describe('Flow trigger'),
  actions: z
    .array(
      z.object({
        type: z.string().describe('Action type'),
        config: z.record(z.unknown()).describe('Action configuration'),
      })
    )
    .optional()
    .describe('Flow actions'),
  conditions: z
    .array(
      z.object({
        type: z.string().describe('Condition type'),
        config: z.record(z.unknown()).describe('Condition configuration'),
      })
    )
    .optional()
    .describe('Flow conditions'),
});


export const cloneFlowInputSchema = z.object({
  sourceFlowId: z.string().describe('Source flow ID'),
  targetAppId: z.number().describe('Target application ID'),
  newName: z.string().optional().describe('New flow name'),
  status: z.enum(['active', 'inactive']).optional().describe('Flow status'),
  fieldMapping: z.record(z.number(), z.number()).optional().describe('Map source field IDs to target field IDs'),
});

export const cloneFlowOutputSchema = z.object({
  flow_id: z.string(),
});

/**
 * Hook schemas
 */
export const hookSchema = z.object({
  hook_id: z.number(),
  status: z.enum(['active', 'inactive']),
  type: z.string(),
  url: z.string(),
  ref_type: z.enum(['app', 'space']),
  ref_id: z.number(),
  created_on: z.string().optional(),
  created_by: z
    .object({
      user_id: z.number(),
      name: z.string(),
    })
    .optional(),
});

export const listHooksInputSchema = z.object({
  appId: z.number().describe('Application ID'),
});

export const listHooksOutputSchema = z.array(hookSchema);

export const getHookInputSchema = z.object({
  hookId: z.number().describe('Hook ID'),
});

export const getHookOutputSchema = hookSchema;

export const createHookInputSchema = z.object({
  appId: z.number().describe('Application ID'),
  url: z.string().url().describe('Webhook URL'),
  type: z.string().describe('Hook event type (e.g., item.create, item.update, item.delete)'),
});

export const createHookOutputSchema = z.object({
  hook_id: z.number(),
});

export const createSpaceHookInputSchema = z.object({
  spaceId: z.number().describe('Space ID'),
  url: z.string().url().describe('Webhook URL'),
  type: z.string().describe('Hook event type'),
});

export const createSpaceHookOutputSchema = z.object({
  hook_id: z.number(),
});

export const verifyHookInputSchema = z.object({
  hookId: z.number().describe('Hook ID'),
  code: z.string().describe('Verification code from Podio'),
});


export const cloneHookInputSchema = z.object({
  sourceHookId: z.number().describe('Source hook ID'),
  targetAppId: z.number().describe('Target application ID'),
  newUrl: z.string().url().optional().describe('New webhook URL (uses source URL if not provided)'),
});

export const cloneHookOutputSchema = z.object({
  hook_id: z.number(),
});

/**
 * Type exports for use in tool implementations
 */
export type Organization = z.infer<typeof organizationSchema>;
export type Space = z.infer<typeof spaceSchema>;
export type Application = z.infer<typeof applicationSchema>;
export type AppField = z.infer<typeof appFieldSchema>;
export type Flow = z.infer<typeof flowSchema>;
export type Hook = z.infer<typeof hookSchema>;
