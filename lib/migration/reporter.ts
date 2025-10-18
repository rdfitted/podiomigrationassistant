/**
 * Migration reporting utilities
 * Creates human-readable reports from migration execution results
 */

import {
  MigrationPlan,
  MigrationExecutionResult,
  MigrationReport,
} from '../ai/schemas/migration';

/**
 * Create a comprehensive migration report
 */
export function createMigrationReport(
  plan: MigrationPlan,
  result: MigrationExecutionResult
): MigrationReport {
  const entitiesByType = {
    organization: { total: 0, success: 0, failed: 0, skipped: 0 },
    space: { total: 0, success: 0, failed: 0, skipped: 0 },
    application: { total: 0, success: 0, failed: 0, skipped: 0 },
    flow: { total: 0, success: 0, failed: 0, skipped: 0 },
    hook: { total: 0, success: 0, failed: 0, skipped: 0 },
  };

  result.entityResults.forEach((entityResult) => {
    const typeStats = entitiesByType[entityResult.entityType];
    typeStats.total++;
    if (entityResult.status === 'success') {
      typeStats.success++;
    } else if (entityResult.status === 'failed') {
      typeStats.failed++;
    } else {
      typeStats.skipped++;
    }
  });

  const totalDuration = calculateTotalDuration(result);
  const topErrors = getTopErrors(result.errors, 5);
  const topWarnings = getTopWarnings(result.warnings, 5);

  const report: MigrationReport = {
    planId: plan.planId,
    sourceWorkspaceId: plan.sourceWorkspaceId,
    targetWorkspaceId: plan.targetWorkspaceId,
    executionResult: result,
    summary: {
      totalDuration,
      entitiesByType,
      topErrors,
      topWarnings,
    },
    recommendations: generateRecommendations(result, entitiesByType),
    nextSteps: generateNextSteps(result, entitiesByType),
  };

  return report;
}

/**
 * Format conflicts for display
 */
export function formatConflicts(conflicts: any[]): string[] {
  return conflicts.map((conflict) => {
    const severity = conflict.severity.toUpperCase();
    return `[${severity}] ${conflict.entityType} "${conflict.entityName}": ${conflict.message}`;
  });
}

/**
 * Calculate total migration duration
 */
function calculateTotalDuration(result: MigrationExecutionResult): string {
  const start = new Date(result.startedAt).getTime();
  const end = result.completedAt ? new Date(result.completedAt).getTime() : Date.now();
  const durationMs = end - start;

  if (durationMs < 1000) return `${durationMs}ms`;
  if (durationMs < 60000) return `${(durationMs / 1000).toFixed(1)}s`;
  if (durationMs < 3600000) return `${(durationMs / 60000).toFixed(1)}m`;
  return `${(durationMs / 3600000).toFixed(1)}h`;
}

/**
 * Get top errors
 */
function getTopErrors(errors: string[], limit: number): string[] {
  const uniqueErrors = [...new Set(errors)];
  return uniqueErrors.slice(0, limit);
}

/**
 * Get top warnings
 */
function getTopWarnings(warnings: string[], limit: number): string[] {
  const uniqueWarnings = [...new Set(warnings)];
  return uniqueWarnings.slice(0, limit);
}

/**
 * Generate recommendations based on results
 */
function generateRecommendations(
  result: MigrationExecutionResult,
  entitiesByType: any
): string[] {
  const recommendations: string[] = [];

  if (result.failedCount > 0) {
    recommendations.push(
      `Review ${result.failedCount} failed entities and retry migration for those items`
    );
  }

  if (entitiesByType.hook.total > 0) {
    recommendations.push(
      'Verify all migrated webhooks to ensure they are properly configured and active'
    );
  }

  if (entitiesByType.flow.total > 0) {
    recommendations.push(
      'Test all migrated flows before activating them in the production workspace'
    );
  }

  if (entitiesByType.application.total > 0) {
    recommendations.push(
      'Review app reference fields and ensure cross-app relationships are correctly mapped'
    );
  }

  if (result.warnings.length > 0) {
    recommendations.push(`Address ${result.warnings.length} warnings to ensure data integrity`);
  }

  return recommendations;
}

/**
 * Generate next steps based on results
 */
function generateNextSteps(result: MigrationExecutionResult, entitiesByType: any): string[] {
  const nextSteps: string[] = [];

  if (result.status === 'completed') {
    nextSteps.push('Migration completed successfully');
    nextSteps.push('Verify all migrated resources in the target workspace');
    nextSteps.push('Test critical workflows and integrations');
    nextSteps.push('Update any external integrations to point to new webhooks');
    nextSteps.push('Archive or deactivate source workspace resources as needed');
  } else if (result.status === 'partial') {
    nextSteps.push('Review failed entities and determine root cause');
    nextSteps.push('Fix any configuration issues and retry migration for failed items');
    nextSteps.push('Verify successfully migrated resources');
    nextSteps.push('Consider creating a new migration plan for remaining items');
  } else {
    nextSteps.push('Migration failed - review errors and conflicts');
    nextSteps.push('Check Podio API credentials and permissions');
    nextSteps.push('Verify source and target workspace access');
    nextSteps.push('Review migration plan for configuration issues');
    nextSteps.push('Consider breaking migration into smaller batches');
  }

  return nextSteps;
}
