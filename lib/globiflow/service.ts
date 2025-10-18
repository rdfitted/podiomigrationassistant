/**
 * GlobiFlow Clone Service
 * High-level service layer for flow discovery, cloning, and job management
 */

import { getFlows } from '@/lib/podio/resources/flows';
import { cloneFlowToApp } from '@/lib/podio/migration';
import { getApplication } from '@/lib/podio/resources/applications';
import { migrationStateStore } from '@/lib/migration/state-store';
import { logger } from '@/lib/migration/logging';
import { FlowSummary, FlowCloneRequest, FlowCloneJob, FlowCloneStep } from './types';
import { Flow } from '@/lib/podio/types';

/**
 * List all flows for an application, mapped to FlowSummary format
 *
 * @param appId - Application ID
 * @returns {Promise<FlowSummary[]>} List of flow summaries
 */
export async function listAppFlows(appId: number): Promise<FlowSummary[]> {
  try {
    logger.info('Listing flows for app', { appId });
    const flows: Flow[] = await getFlows(appId);

    // Map to FlowSummary format
    const summaries: FlowSummary[] = flows.map((flow) => ({
      id: flow.flow_id,
      name: flow.name,
      status: flow.status,
      triggerType: flow.trigger?.type || 'unknown',
      lastRun: undefined, // Not available from basic flow data
      app_id: flow.app_id,
    }));

    logger.info('Found flows', { appId, count: summaries.length });
    return summaries;
  } catch (error) {
    logger.error('Failed to list flows', { appId, error });
    throw error;
  }
}

/**
 * Create a flow clone job
 *
 * @param request - Clone request details
 * @returns {Promise<FlowCloneJob>} Created job
 */
export async function createFlowCloneJob(
  request: FlowCloneRequest
): Promise<FlowCloneJob> {
  try {
    logger.info('Creating flow clone job', {
      sourceAppId: request.sourceAppId,
      targetAppId: request.targetAppId,
      flowCount: request.flows.length,
    });

    // Initialize migration state store
    await migrationStateStore.initialize();

    // Create base migration job
    const baseJob = await migrationStateStore.createMigrationJob(
      request.sourceAppId.toString(),
      request.targetAppId.toString(),
      {
        jobType: 'flow_clone',
        sourceAppId: request.sourceAppId,
        targetAppId: request.targetAppId,
        continueOnError: request.continueOnError || false,
        flowCount: request.flows.length,
      }
    );

    // Add flow clone steps
    for (const flow of request.flows) {
      await migrationStateStore.addMigrationStep(
        baseJob.id,
        'clone_flow',
        flow.flowId
      );
    }

    // Retrieve updated job with steps
    const job = await migrationStateStore.getMigrationJob(baseJob.id);
    if (!job) {
      throw new Error('Failed to retrieve created job');
    }

    // Cast to FlowCloneJob with metadata
    const flowCloneJob: FlowCloneJob = {
      ...job,
      jobType: 'flow_clone',
      sourceAppId: request.sourceAppId,
      targetAppId: request.targetAppId,
      continueOnError: request.continueOnError || false,
    };

    logger.info('Flow clone job created', { jobId: flowCloneJob.id });
    return flowCloneJob;
  } catch (error) {
    logger.error('Failed to create flow clone job', { request, error });
    throw error;
  }
}

/**
 * Generate field mapping by matching field labels/external IDs between apps
 */
async function generateFieldMapping(
  sourceAppId: number,
  targetAppId: number
): Promise<Array<{ source_field_id: number; target_field_id: number }>> {
  try {
    const [sourceApp, targetApp] = await Promise.all([
      getApplication(sourceAppId),
      getApplication(targetAppId),
    ]);

    const fieldMapping: Array<{ source_field_id: number; target_field_id: number }> = [];

    const sourceFields = sourceApp.fields || [];
    const targetFields = targetApp.fields || [];

    // Match fields by external_id first, then by label
    for (const sourceField of sourceFields) {
      const targetField = targetFields.find(
        (f) =>
          (f.external_id && f.external_id === sourceField.external_id) ||
          (f.config.label && f.config.label === sourceField.config.label)
      );

      if (targetField) {
        fieldMapping.push({
          source_field_id: sourceField.field_id,
          target_field_id: targetField.field_id,
        });
      }
    }

    logger.info('Generated field mapping', {
      sourceAppId,
      targetAppId,
      mappedFields: fieldMapping.length,
      totalSourceFields: sourceFields.length,
    });

    return fieldMapping;
  } catch (error) {
    logger.error('Failed to generate field mapping', { sourceAppId, targetAppId, error });
    return [];
  }
}

/**
 * Execute a single flow clone step
 *
 * @param jobId - Job ID
 * @param stepId - Step ID
 * @param sourceFlowId - Source flow ID
 * @param sourceAppId - Source app ID
 * @param targetAppId - Target app ID
 * @param newName - Optional new flow name
 */
export async function executeFlowCloneStep(
  jobId: string,
  stepId: string,
  sourceFlowId: string,
  sourceAppId: number,
  targetAppId: number,
  newName?: string
): Promise<void> {
  try {
    logger.info('Executing flow clone step', {
      jobId,
      stepId,
      sourceFlowId,
      sourceAppId,
      targetAppId,
    });

    // Update step status to in_progress
    await migrationStateStore.updateMigrationStep(jobId, stepId, {
      status: 'in_progress',
      startedAt: new Date(),
    });

    // Generate field mapping between source and target apps
    const fieldMapping = await generateFieldMapping(sourceAppId, targetAppId);

    // Clone the flow with field remapping
    const result = await cloneFlowToApp(sourceFlowId, targetAppId, fieldMapping);

    // Update step status to completed
    await migrationStateStore.updateMigrationStep(jobId, stepId, {
      status: 'completed',
      targetId: result.flow_id,
      completedAt: new Date(),
    });

    logger.info('Flow clone step completed', {
      jobId,
      stepId,
      targetFlowId: result.flow_id,
      referencesUpdated: result.references_updated,
    });
  } catch (error) {
    logger.error('Flow clone step failed', { jobId, stepId, sourceFlowId, error });

    // Update step with error
    await migrationStateStore.updateMigrationStep(jobId, stepId, {
      status: 'failed',
      error: error instanceof Error ? error.message : 'Unknown error',
      completedAt: new Date(),
    });

    // Add error to job
    await migrationStateStore.addMigrationError(
      jobId,
      `clone_flow_${sourceFlowId}`,
      error instanceof Error ? error.message : 'Unknown error',
      'FLOW_CLONE_ERROR'
    );

    throw error;
  }
}

/**
 * Get job status with flow-specific details
 *
 * @param jobId - Job ID
 * @returns {Promise<FlowCloneJob | null>} Job with status
 */
export async function getFlowCloneJobStatus(
  jobId: string
): Promise<FlowCloneJob | null> {
  try {
    const job = await migrationStateStore.getMigrationJob(jobId);
    if (!job) {
      return null;
    }

    // Cast to FlowCloneJob
    const flowCloneJob: FlowCloneJob = {
      ...job,
      jobType: 'flow_clone',
      sourceAppId: job.metadata?.sourceAppId as number,
      targetAppId: job.metadata?.targetAppId as number,
      continueOnError: (job.metadata?.continueOnError as boolean) || false,
    };

    return flowCloneJob;
  } catch (error) {
    logger.error('Failed to get flow clone job status', { jobId, error });
    throw error;
  }
}
