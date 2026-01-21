/**
 * Zod schemas for migration planning and execution
 * These schemas validate migration-related tool inputs/outputs for the AI agent
 */

import { z } from 'zod';
import { isValidDateFormat } from '../../migration/items/filter-validator';

const itemMigrationDateSchema = z.string().refine(isValidDateFormat, {
  message:
    'Invalid date format. Expected ISO 8601 (e.g., "2025-01-01", "2025-01-01 09:30:00", "2025-01-01T09:30:00", "2025-01-01T09:30:00Z", or "2025-01-01T09:30:00+00:00")',
});

const itemMigrationDateFiltersSchema = z.object({
  createdFrom: itemMigrationDateSchema
    .optional()
    .describe('Filter items created on or after this date (ISO 8601)'),
  createdTo: itemMigrationDateSchema
    .optional()
    .describe('Filter items created on or before this date (ISO 8601)'),
  lastEditFrom: itemMigrationDateSchema
    .optional()
    .describe('Filter items last edited on or after this date (ISO 8601)'),
  lastEditTo: itemMigrationDateSchema
    .optional()
    .describe('Filter items last edited on or before this date (ISO 8601)'),
});

/**
 * Migration scope definition
 */
export const migrationScopeSchema = z.object({
  includeOrganizations: z.boolean().optional().describe('Include organization metadata'),
  includeSpaces: z.boolean().optional().describe('Include spaces'),
  includeApplications: z.boolean().optional().describe('Include applications'),
  includeFlows: z.boolean().optional().describe('Include Globiflow workflows'),
  includeHooks: z.boolean().optional().describe('Include webhooks'),
  specificSpaceIds: z.array(z.number()).optional().describe('Specific space IDs to migrate'),
  specificAppIds: z.array(z.number()).optional().describe('Specific application IDs to migrate'),
});

/**
 * Migration entity statuses
 */
export const migrationEntityStatusSchema = z.enum([
  'pending',
  'planned',
  'executing',
  'completed',
  'error',
  'skipped',
]);

/**
 * Migration conflict types
 */
export const migrationConflictSchema = z.object({
  type: z.enum([
    'name_collision',
    'missing_dependency',
    'field_type_mismatch',
    'app_reference_broken',
    'flow_dependency_missing',
    'hook_validation_failed',
    'permission_denied',
    'rate_limit_exceeded',
  ]),
  severity: z.enum(['error', 'warning', 'info']),
  entityType: z.enum(['organization', 'space', 'application', 'flow', 'hook']),
  entityId: z.union([z.number(), z.string()]),
  entityName: z.string(),
  message: z.string(),
  suggestedResolution: z.string().optional(),
  canAutoresolve: z.boolean().default(false),
});

/**
 * Migration entity (node in the dependency graph)
 */
export const migrationEntitySchema = z.object({
  entityType: z.enum(['organization', 'space', 'application', 'flow', 'hook']),
  sourceId: z.union([z.number(), z.string()]),
  sourceName: z.string(),
  targetId: z.union([z.number(), z.string()]).optional(),
  status: migrationEntityStatusSchema,
  dependencies: z.array(z.union([z.number(), z.string()])).default([]),
  metadata: z.record(z.unknown()).optional(),
  conflicts: z.array(migrationConflictSchema).default([]),
  error: z.string().optional(),
});

/**
 * Field mapping for application migrations
 */
export const fieldMappingSchema = z.object({
  sourceAppId: z.number(),
  targetAppId: z.number(),
  fieldMappings: z.record(
    z.number(), // source field ID
    z.number() // target field ID
  ),
});

/**
 * Migration plan
 */
export const migrationPlanSchema = z.object({
  planId: z.string(),
  sourceWorkspaceId: z.number().describe('Source organization ID'),
  targetWorkspaceId: z.number().describe('Target organization ID'),
  scope: migrationScopeSchema,
  entities: z.array(migrationEntitySchema),
  fieldMappings: z.array(fieldMappingSchema).default([]),
  executionOrder: z.array(z.union([z.number(), z.string()])).describe('Ordered list of entity IDs to process'),
  conflicts: z.array(migrationConflictSchema).default([]),
  estimatedDuration: z.string().optional().describe('Estimated time to complete'),
  createdAt: z.string(),
  updatedAt: z.string().optional(),
  status: z.enum(['draft', 'ready', 'executing', 'completed', 'failed']).default('draft'),
});

/**
 * Migration execution options
 */
export const migrationExecutionOptionsSchema = z.object({
  dryRun: z.boolean().default(false).describe('Execute in dry-run mode (no actual changes)'),
  continueOnError: z.boolean().default(false).describe('Continue execution even if individual entities fail'),
  autoResolveConflicts: z.boolean().default(false).describe('Attempt to auto-resolve conflicts where possible'),
  batchSize: z.number().min(1).max(100).default(10).describe('Number of entities to process in parallel'),
  confirmBeforeExecute: z.boolean().default(true).describe('Require explicit confirmation before execution'),
  enableRollback: z.boolean().default(true).describe('Enable rollback capability'),
  notifyOnProgress: z.boolean().default(true).describe('Send progress notifications'),
});

/**
 * Migration entity result
 */
export const migrationEntityResultSchema = z.object({
  entityType: z.enum(['organization', 'space', 'application', 'flow', 'hook']),
  sourceId: z.union([z.number(), z.string()]),
  sourceName: z.string(),
  targetId: z.union([z.number(), z.string()]).optional(),
  status: z.enum(['success', 'failed', 'skipped']),
  error: z.string().optional(),
  warnings: z.array(z.string()).default([]),
  createdAt: z.string().optional(),
  duration: z.number().optional().describe('Execution time in milliseconds'),
});

/**
 * Migration execution result
 */
export const migrationExecutionResultSchema = z.object({
  planId: z.string(),
  status: z.enum(['completed', 'partial', 'failed']),
  startedAt: z.string(),
  completedAt: z.string().optional(),
  dryRun: z.boolean(),
  totalEntities: z.number(),
  successCount: z.number(),
  failedCount: z.number(),
  skippedCount: z.number(),
  entityResults: z.array(migrationEntityResultSchema),
  conflicts: z.array(migrationConflictSchema).default([]),
  errors: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([]),
});

/**
 * Migration report summary
 */
export const migrationReportSchema = z.object({
  planId: z.string(),
  sourceWorkspaceId: z.number(),
  sourceWorkspaceName: z.string().optional(),
  targetWorkspaceId: z.number(),
  targetWorkspaceName: z.string().optional(),
  executionResult: migrationExecutionResultSchema,
  summary: z.object({
    totalDuration: z.string().optional(),
    entitiesByType: z.record(
      z.object({
        total: z.number(),
        success: z.number(),
        failed: z.number(),
        skipped: z.number(),
      })
    ),
    topErrors: z.array(z.string()).optional(),
    topWarnings: z.array(z.string()).optional(),
  }),
  recommendations: z.array(z.string()).default([]),
  nextSteps: z.array(z.string()).default([]),
});

/**
 * Tool input/output schemas for migration planning
 */
export const planWorkspaceMigrationInputSchema = z.object({
  sourceWorkspaceId: z.number().describe('Source organization ID'),
  targetWorkspaceId: z.number().describe('Target organization ID'),
  scope: migrationScopeSchema.optional().describe('Migration scope configuration'),
});

export const planWorkspaceMigrationOutputSchema = z.object({
  plan: migrationPlanSchema,
  summary: z.string().describe('Human-readable plan summary'),
  conflicts: z.array(migrationConflictSchema),
  requiresConfirmation: z.boolean(),
});

export const validateMigrationPlanInputSchema = z.object({
  planId: z.string().describe('Migration plan ID'),
});

export const validateMigrationPlanOutputSchema = z.object({
  valid: z.boolean(),
  conflicts: z.array(migrationConflictSchema),
  warnings: z.array(z.string()),
  canProceed: z.boolean(),
});

export const executeMigrationPlanInputSchema = z.object({
  planId: z.string().describe('Migration plan ID'),
  options: migrationExecutionOptionsSchema.optional().describe('Execution options'),
  confirmed: z.boolean().default(false).describe('User has confirmed execution'),
});

export const executeMigrationPlanOutputSchema = z.object({
  result: migrationExecutionResultSchema,
  report: migrationReportSchema.optional(),
});

export const resumeMigrationInputSchema = z.object({
  planId: z.string().describe('Migration plan ID to resume'),
  fromEntityId: z.union([z.number(), z.string()]).optional().describe('Resume from specific entity'),
});

export const getMigrationStatusInputSchema = z.object({
  planId: z.string().describe('Migration plan ID'),
});

export const getMigrationStatusOutputSchema = z.object({
  planId: z.string(),
  status: z.enum(['draft', 'ready', 'executing', 'completed', 'failed']),
  progress: z.object({
    total: z.number(),
    completed: z.number(),
    failed: z.number(),
    remaining: z.number(),
    percentage: z.number(),
  }),
  currentEntity: migrationEntitySchema.optional(),
  estimatedTimeRemaining: z.string().optional(),
});

/**
 * Type exports for use in migration services
 */
export type MigrationScope = z.infer<typeof migrationScopeSchema>;
export type MigrationConflict = z.infer<typeof migrationConflictSchema>;
export type MigrationEntity = z.infer<typeof migrationEntitySchema>;
export type MigrationPlan = z.infer<typeof migrationPlanSchema>;
export type MigrationExecutionOptions = z.infer<typeof migrationExecutionOptionsSchema>;
export type MigrationEntityResult = z.infer<typeof migrationEntityResultSchema>;
export type MigrationExecutionResult = z.infer<typeof migrationExecutionResultSchema>;
export type MigrationReport = z.infer<typeof migrationReportSchema>;
export type FieldMapping = z.infer<typeof fieldMappingSchema>;

// ============================================================================
// PHASE 5: Data Migration Schemas
// ============================================================================

/**
 * Migration mode for item operations
 */
export const migrationModeSchema = z.enum(['create', 'update', 'upsert']);

/**
 * Get item count input
 */
export const getItemCountInputSchema = z.object({
  appId: z.number().describe('Podio app ID'),
  filters: z.record(z.unknown()).optional().describe('Optional filters to apply'),
}).merge(itemMigrationDateFiltersSchema);

/**
 * Get item count output
 */
export const getItemCountOutputSchema = z.object({
  success: z.boolean(),
  total: z.number().describe('Total items in app'),
  filtered: z.number().describe('Filtered item count'),
  sampledAt: z.string().describe('Timestamp of count'),
});

/**
 * Duplicate behavior for create mode
 */
export const duplicateBehaviorSchema = z.enum(['skip', 'error', 'update']);

/**
 * Migrate items input
 */
export const migrateItemsInputSchema = z.object({
  sourceAppId: z.number().describe('Source app ID'),
  targetAppId: z.number().describe('Target app ID'),
  fieldMapping: z.record(z.string()).describe('Field mapping (source external_id -> target external_id)'),
  mode: migrationModeSchema.default('create').describe('Migration mode'),
  sourceMatchField: z.string().optional().describe('Source field external_id to extract value from for matching'),
  targetMatchField: z.string().optional().describe('Target field external_id to search by for matching'),
  duplicateBehavior: duplicateBehaviorSchema.default('skip').describe('How to handle duplicates when match fields are set (skip/error/update)'),
  batchSize: z.number().min(100).max(1000).default(500).describe('Batch size for processing'),
  concurrency: z.number().min(1).max(10).default(5).describe('Concurrent API requests'),
  stopOnError: z.boolean().default(false).describe('Stop on first error'),
  filters: z.record(z.unknown()).optional().describe('Filters for source items'),
  resumeToken: z.string().optional().describe('Token to resume from checkpoint'),
}).merge(itemMigrationDateFiltersSchema);

/**
 * Migrate items output
 */
export const migrateItemsOutputSchema = z.object({
  success: z.boolean(),
  migrationId: z.string().describe('Migration job ID'),
  processed: z.number().describe('Total items processed'),
  successful: z.number().describe('Successfully migrated items'),
  failed: z.number().describe('Failed items'),
  failedItems: z.array(z.object({
    sourceItemId: z.number(),
    error: z.string(),
    index: z.number(),
  })).describe('Details of failed items'),
  durationMs: z.number().describe('Migration duration in milliseconds'),
  throughput: z.number().describe('Items per second'),
  completed: z.boolean().describe('Whether migration completed'),
  resumeToken: z.string().optional().describe('Token to resume if interrupted'),
});

/**
 * Export items input
 */
export const exportItemsInputSchema = z.object({
  appId: z.number().describe('App ID to export from'),
  outputPath: z.string().optional().describe('Output file path (default: data/exports/app-{appId}.json)'),
  filters: z.record(z.unknown()).optional().describe('Filters to apply'),
  format: z.enum(['json', 'ndjson']).default('json').describe('Export format'),
  batchSize: z.number().min(100).max(1000).default(500).describe('Batch size for streaming'),
}).merge(itemMigrationDateFiltersSchema);

/**
 * Export items output
 */
export const exportItemsOutputSchema = z.object({
  success: z.boolean(),
  filePath: z.string().describe('Path to exported file'),
  total: z.number().describe('Total items exported'),
  warnings: z.array(z.string()).optional().describe('Export warnings'),
});

/**
 * Import items input
 */
export const importItemsInputSchema = z.object({
  targetAppId: z.number().describe('Target app ID'),
  sourceFilePath: z.string().describe('Path to source file (JSON)'),
  mode: migrationModeSchema.default('create').describe('Import mode'),
  batchSize: z.number().min(100).max(1000).default(500).describe('Batch size'),
  dryRun: z.boolean().default(false).describe('Dry run (validate without importing)'),
});

/**
 * Import items output
 */
export const importItemsOutputSchema = z.object({
  success: z.boolean(),
  processed: z.number().describe('Items processed'),
  successful: z.number().describe('Successfully imported'),
  failed: z.number().describe('Failed imports'),
  failedItems: z.array(z.object({
    index: z.number(),
    error: z.string(),
  })).describe('Failed item details'),
  dryRunSummary: z.object({
    wouldProcess: z.number(),
    estimatedDuration: z.string(),
  }).optional().describe('Dry run results'),
});

/**
 * Validate item migration input
 */
export const validateItemMigrationInputSchema = z.object({
  sourceAppId: z.number().describe('Source app ID'),
  targetAppId: z.number().describe('Target app ID'),
  fieldMapping: z.record(z.string()).describe('Field mapping used for migration'),
  sampleSize: z.number().min(10).max(1000).default(100).describe('Sample size for validation'),
  strict: z.boolean().default(false).describe('Strict validation (all fields must match)'),
});

/**
 * Validate item migration output
 */
export const validateItemMigrationOutputSchema = z.object({
  success: z.boolean(),
  total: z.number().describe('Total items validated'),
  matched: z.number().describe('Items that matched'),
  mismatched: z.array(z.object({
    sourceItemId: z.number(),
    targetItemId: z.number(),
    differences: z.record(z.object({
      source: z.unknown(),
      target: z.unknown(),
    })),
  })).describe('Items with mismatches'),
  missingInTarget: z.number().describe('Items missing in target'),
  missingInSource: z.number().describe('Unexpected items in target'),
});

/**
 * Type exports for data migration
 */
export type MigrationMode = z.infer<typeof migrationModeSchema>;
export type DuplicateBehavior = z.infer<typeof duplicateBehaviorSchema>;
export type GetItemCountInput = z.infer<typeof getItemCountInputSchema>;
export type GetItemCountOutput = z.infer<typeof getItemCountOutputSchema>;
export type MigrateItemsInput = z.infer<typeof migrateItemsInputSchema>;
export type MigrateItemsOutput = z.infer<typeof migrateItemsOutputSchema>;
export type ExportItemsInput = z.infer<typeof exportItemsInputSchema>;
export type ExportItemsOutput = z.infer<typeof exportItemsOutputSchema>;
export type ImportItemsInput = z.infer<typeof importItemsInputSchema>;
export type ImportItemsOutput = z.infer<typeof importItemsOutputSchema>;
export type ValidateItemMigrationInput = z.infer<typeof validateItemMigrationInputSchema>;
export type ValidateItemMigrationOutput = z.infer<typeof validateItemMigrationOutputSchema>;
