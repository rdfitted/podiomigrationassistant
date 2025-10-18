/**
 * Zod schemas for AI tool inputs and outputs
 * Provides type-safe validation for agent tool calls
 */

import { z } from 'zod';

// ============================================================================
// Base Identifier Schemas
// ============================================================================

export const orgIdSchema = z.number().int().positive().describe('Organization ID');
export const spaceIdSchema = z.number().int().positive().describe('Space ID');
export const appIdSchema = z.number().int().positive().describe('Application ID');
export const flowIdSchema = z.string().describe('Flow ID');
export const hookIdSchema = z.number().int().positive().describe('Hook ID');
export const fieldIdSchema = z.number().int().positive().describe('Field ID');

// ============================================================================
// Shared Type Fragments
// ============================================================================

/**
 * Podio app field structure
 */
export const podioAppFieldSchema = z.object({
  field_id: z.number(),
  type: z.string(),
  external_id: z.string(),
  label: z.string(),
  required: z.boolean().optional(),
  unique: z.boolean().optional(),
  referenced_apps: z.array(z.object({
    app_id: z.number(),
    view_id: z.number().optional(),
  })).optional().nullable(),
});

/**
 * Podio app structure
 */
export const podioAppStructureSchema = z.object({
  app_id: z.number(),
  name: z.string(),
  item_name: z.string().optional(),
  space_id: z.number(),
  fields: z.array(podioAppFieldSchema),
  field_count: z.number(),
});

/**
 * Podio flow definition (summary)
 */
export const podioFlowDefinitionSchema = z.object({
  flow_id: z.string(),
  name: z.string(),
  status: z.enum(['active', 'inactive']),
  type: z.string().optional(),
});

/**
 * Podio hook definition
 */
export const podioHookDefinitionSchema = z.object({
  hook_id: z.number(),
  type: z.string(),
  url: z.string(),
  status: z.enum(['active', 'inactive']),
});

/**
 * Common success/error response wrapper
 */
export const toolResponseSchema = z.object({
  success: z.boolean(),
  data: z.any().optional(),
  error: z.object({
    message: z.string(),
    status: z.number().optional(),
    code: z.string().optional(),
    detail: z.string().optional(),
  }).optional(),
});

// ============================================================================
// Discovery Tool Schemas
// ============================================================================

/**
 * listOrganizations - No input required
 */
export const listOrganizationsInputSchema = z.object({});

export const listOrganizationsOutputSchema = z.object({
  success: z.boolean(),
  data: z.array(z.object({
    org_id: z.number(),
    name: z.string(),
    url: z.string(),
    role: z.string().optional(),
    member_count: z.number().optional(),
  })).optional(),
  error: z.object({
    message: z.string(),
    status: z.number().optional(),
    code: z.string().optional(),
  }).optional(),
});

/**
 * listSpaces - Requires organization ID
 */
export const listSpacesInputSchema = z.object({
  organizationId: orgIdSchema,
});

export const listSpacesOutputSchema = z.object({
  success: z.boolean(),
  data: z.array(z.object({
    space_id: z.number(),
    name: z.string(),
    url: z.string(),
    org_id: z.number(),
    privacy: z.enum(['open', 'closed']).optional(),
    role: z.string().optional(),
  })).optional(),
  error: z.object({
    message: z.string(),
    status: z.number().optional(),
    code: z.string().optional(),
  }).optional(),
});

/**
 * getSpaceApps - Requires space ID
 */
export const getSpaceAppsInputSchema = z.object({
  spaceId: spaceIdSchema,
});

export const getSpaceAppsOutputSchema = z.object({
  success: z.boolean(),
  data: z.array(z.object({
    app_id: z.number(),
    name: z.string(),
    url_label: z.string().optional(),
    flows_count: z.number(),
    hooks_count: z.number(),
  })).optional(),
  error: z.object({
    message: z.string(),
    status: z.number().optional(),
    code: z.string().optional(),
  }).optional(),
});

/**
 * getAppStructure - Requires app ID
 */
export const getAppStructureInputSchema = z.object({
  appId: appIdSchema,
});

export const getAppStructureOutputSchema = z.object({
  success: z.boolean(),
  data: podioAppStructureSchema.optional(),
  error: z.object({
    message: z.string(),
    status: z.number().optional(),
    code: z.string().optional(),
  }).optional(),
});

/**
 * getAppFlows - Requires app ID
 */
export const getAppFlowsInputSchema = z.object({
  appId: appIdSchema,
});

export const getAppFlowsOutputSchema = z.object({
  success: z.boolean(),
  data: z.array(podioFlowDefinitionSchema).optional(),
  error: z.object({
    message: z.string(),
    status: z.number().optional(),
    code: z.string().optional(),
  }).optional(),
});

/**
 * getAppHooks - Requires app ID
 */
export const getAppHooksInputSchema = z.object({
  appId: appIdSchema,
});

export const getAppHooksOutputSchema = z.object({
  success: z.boolean(),
  data: z.array(podioHookDefinitionSchema).optional(),
  error: z.object({
    message: z.string(),
    status: z.number().optional(),
    code: z.string().optional(),
  }).optional(),
});

// ============================================================================
// Migration Tool Schemas
// ============================================================================

/**
 * createSpace - Requires org ID, name, optional privacy
 */
export const createSpaceInputSchema = z.object({
  organizationId: orgIdSchema,
  name: z.string().min(1).describe('Space name'),
  privacy: z.enum(['open', 'closed']).optional().default('closed').describe('Space privacy setting'),
});

export const createSpaceOutputSchema = z.object({
  success: z.boolean(),
  data: z.object({
    space_id: z.number(),
    name: z.string(),
    url: z.string(),
    org_id: z.number(),
    privacy: z.enum(['open', 'closed']).optional(),
  }).optional(),
  error: z.object({
    message: z.string(),
    status: z.number().optional(),
    code: z.string().optional(),
  }).optional(),
});

/**
 * cloneApp - Requires source app ID and target space ID
 */
export const cloneAppInputSchema = z.object({
  sourceAppId: appIdSchema.describe('Source application ID to clone'),
  targetSpaceId: spaceIdSchema.describe('Target space ID where app will be created'),
  newName: z.string().optional().describe('Optional new name for cloned app'),
});

export const cloneAppOutputSchema = z.object({
  success: z.boolean(),
  data: z.object({
    app_id: z.number(),
    name: z.string(),
    space_id: z.number(),
    field_mapping: z.array(z.object({
      source_field_id: z.number(),
      target_field_id: z.number(),
      label: z.string(),
    })),
    fields_cloned: z.number(),
  }).optional(),
  error: z.object({
    message: z.string(),
    status: z.number().optional(),
    code: z.string().optional(),
  }).optional(),
});

/**
 * cloneFlow - Requires source flow ID and target app ID
 */
export const cloneFlowInputSchema = z.object({
  sourceFlowId: flowIdSchema.describe('Source flow ID to clone'),
  targetAppId: appIdSchema.describe('Target app ID where flow will be created'),
  fieldMapping: z.array(z.object({
    source_field_id: z.number(),
    target_field_id: z.number(),
  })).optional().describe('Optional field ID mapping for reference updates'),
});

export const cloneFlowOutputSchema = z.object({
  success: z.boolean(),
  data: z.object({
    flow_id: z.string(),
    name: z.string(),
    app_id: z.number(),
    status: z.enum(['active', 'inactive']),
    references_updated: z.number(),
  }).optional(),
  error: z.object({
    message: z.string(),
    status: z.number().optional(),
    code: z.string().optional(),
  }).optional(),
});

/**
 * cloneHook - Requires source hook ID and target app ID
 */
export const cloneHookInputSchema = z.object({
  sourceHookId: hookIdSchema.describe('Source hook ID to clone'),
  targetAppId: appIdSchema.describe('Target app ID where hook will be created'),
  urlOverride: z.string().url().optional().describe('Optional URL override for the cloned hook'),
});

export const cloneHookOutputSchema = z.object({
  success: z.boolean(),
  data: z.object({
    hook_id: z.number(),
    type: z.string(),
    url: z.string(),
    status: z.enum(['active', 'inactive']),
    app_id: z.number(),
  }).optional(),
  error: z.object({
    message: z.string(),
    status: z.number().optional(),
    code: z.string().optional(),
  }).optional(),
});

/**
 * updateAppReferences - Update cross-app field references
 */
export const updateAppReferencesInputSchema = z.object({
  appId: appIdSchema.describe('App ID containing fields to update'),
  referenceMappings: z.array(z.object({
    field_id: z.number().describe('Field ID to update'),
    old_app_ids: z.array(z.number()).describe('Old referenced app IDs'),
    new_app_ids: z.array(z.number()).describe('New referenced app IDs'),
  })).describe('Array of reference mapping instructions'),
});

export const updateAppReferencesOutputSchema = z.object({
  success: z.boolean(),
  data: z.object({
    updated_fields: z.number(),
    unresolved_references: z.array(z.object({
      field_id: z.number(),
      field_label: z.string(),
      reason: z.string(),
    })),
  }).optional(),
  error: z.object({
    message: z.string(),
    status: z.number().optional(),
    code: z.string().optional(),
  }).optional(),
});

// ============================================================================
// Validation Tool Schemas
// ============================================================================

/**
 * validateAppStructure - Compare source and target app structures
 */
export const validateAppStructureInputSchema = z.object({
  sourceAppId: appIdSchema.describe('Source app ID'),
  targetAppId: appIdSchema.describe('Target app ID'),
  strictMode: z.boolean().optional().default(false).describe('Strict validation mode'),
});

export const validateAppStructureOutputSchema = z.object({
  success: z.boolean(),
  data: z.object({
    valid: z.boolean(),
    differences: z.array(z.object({
      type: z.enum(['missing_field', 'extra_field', 'field_type_mismatch', 'config_mismatch']),
      field_label: z.string(),
      severity: z.enum(['error', 'warning', 'info']),
      details: z.string(),
    })),
    source_field_count: z.number(),
    target_field_count: z.number(),
  }).optional(),
  error: z.object({
    message: z.string(),
    status: z.number().optional(),
    code: z.string().optional(),
  }).optional(),
});

/**
 * testFlow - Test a flow execution
 */
export const testFlowInputSchema = z.object({
  flowId: flowIdSchema.describe('Flow ID to test'),
  testPayload: z.record(z.any()).optional().describe('Optional test data payload'),
});

export const testFlowOutputSchema = z.object({
  success: z.boolean(),
  data: z.object({
    flow_id: z.string(),
    test_successful: z.boolean(),
    execution_logs: z.array(z.string()),
    errors: z.array(z.string()),
  }).optional(),
  error: z.object({
    message: z.string(),
    status: z.number().optional(),
    code: z.string().optional(),
  }).optional(),
});

/**
 * getMigrationStatus - Get migration progress status
 */
export const getMigrationStatusInputSchema = z.object({
  migrationId: z.string().describe('Migration job identifier'),
});

export const getMigrationStatusOutputSchema = z.object({
  success: z.boolean(),
  data: z.object({
    migration_id: z.string(),
    status: z.enum(['pending', 'running', 'completed', 'failed']),
    progress: z.object({
      total_items: z.number(),
      completed_items: z.number(),
      failed_items: z.number(),
      percentage: z.number(),
    }),
    created_at: z.string(),
    updated_at: z.string(),
    summary: z.object({
      spaces_created: z.number(),
      apps_cloned: z.number(),
      flows_cloned: z.number(),
      hooks_cloned: z.number(),
    }),
  }).optional(),
  error: z.object({
    message: z.string(),
    status: z.number().optional(),
    code: z.string().optional(),
  }).optional(),
});

// ============================================================================
// Export TypeScript Types
// ============================================================================

export type ListOrganizationsInput = z.infer<typeof listOrganizationsInputSchema>;
export type ListOrganizationsOutput = z.infer<typeof listOrganizationsOutputSchema>;

export type ListSpacesInput = z.infer<typeof listSpacesInputSchema>;
export type ListSpacesOutput = z.infer<typeof listSpacesOutputSchema>;

export type GetSpaceAppsInput = z.infer<typeof getSpaceAppsInputSchema>;
export type GetSpaceAppsOutput = z.infer<typeof getSpaceAppsOutputSchema>;

export type GetAppStructureInput = z.infer<typeof getAppStructureInputSchema>;
export type GetAppStructureOutput = z.infer<typeof getAppStructureOutputSchema>;

export type GetAppFlowsInput = z.infer<typeof getAppFlowsInputSchema>;
export type GetAppFlowsOutput = z.infer<typeof getAppFlowsOutputSchema>;

export type GetAppHooksInput = z.infer<typeof getAppHooksInputSchema>;
export type GetAppHooksOutput = z.infer<typeof getAppHooksOutputSchema>;

export type CreateSpaceInput = z.infer<typeof createSpaceInputSchema>;
export type CreateSpaceOutput = z.infer<typeof createSpaceOutputSchema>;

export type CloneAppInput = z.infer<typeof cloneAppInputSchema>;
export type CloneAppOutput = z.infer<typeof cloneAppOutputSchema>;

export type CloneFlowInput = z.infer<typeof cloneFlowInputSchema>;
export type CloneFlowOutput = z.infer<typeof cloneFlowOutputSchema>;

export type CloneHookInput = z.infer<typeof cloneHookInputSchema>;
export type CloneHookOutput = z.infer<typeof cloneHookOutputSchema>;

export type UpdateAppReferencesInput = z.infer<typeof updateAppReferencesInputSchema>;
export type UpdateAppReferencesOutput = z.infer<typeof updateAppReferencesOutputSchema>;

export type ValidateAppStructureInput = z.infer<typeof validateAppStructureInputSchema>;
export type ValidateAppStructureOutput = z.infer<typeof validateAppStructureOutputSchema>;

export type TestFlowInput = z.infer<typeof testFlowInputSchema>;
export type TestFlowOutput = z.infer<typeof testFlowOutputSchema>;

export type GetMigrationStatusInput = z.infer<typeof getMigrationStatusInputSchema>;
export type GetMigrationStatusOutput = z.infer<typeof getMigrationStatusOutputSchema>;

// ============================================================================
// PHASE 5: Re-export Data Migration Schemas from migration.ts
// ============================================================================

export {
  getItemCountInputSchema,
  getItemCountOutputSchema,
  migrateItemsInputSchema,
  migrateItemsOutputSchema,
  exportItemsInputSchema,
  exportItemsOutputSchema,
  importItemsInputSchema,
  importItemsOutputSchema,
  validateItemMigrationInputSchema,
  validateItemMigrationOutputSchema,
} from './schemas/migration';
