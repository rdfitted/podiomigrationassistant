/**
 * GlobiFlow Clone Feature Type Definitions
 * Defines types for flow cloning operations in the migration panel
 */

import { MigrationJob, MigrationStep } from '@/lib/migration/state-store';

/**
 * Summary representation of a GlobiFlow automation
 * Used for listing flows in the UI before cloning
 */
export interface FlowSummary {
  id: string;
  name: string;
  status: 'active' | 'inactive';
  triggerType: string;
  lastRun?: string;
  app_id?: number;
}

/**
 * Request payload for initiating flow clone operation
 */
export interface FlowCloneRequest {
  sourceAppId: number;
  targetAppId: number;
  flows: Array<{
    flowId: string;
    newName?: string;
  }>;
  continueOnError?: boolean;
}

/**
 * Extended migration job for flow cloning
 * Reuses MigrationJob structure with flow-specific type
 */
export interface FlowCloneJob extends MigrationJob {
  jobType: 'flow_clone';
  sourceAppId: number;
  targetAppId: number;
  continueOnError: boolean;
}

/**
 * Individual flow clone step in a migration job
 */
export interface FlowCloneStep extends Omit<MigrationStep, 'error'> {
  type: 'clone_flow';
  flowId: string;
  flowName: string;
  targetFlowId?: string;
  error?: {
    message: string;
    code?: string;
    details?: Record<string, unknown>;
  };
}

/**
 * Result of a flow clone operation (for UI consumption)
 */
export interface FlowCloneResult {
  jobId: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'paused';
  totalFlows: number;
  successCount: number;
  failureCount: number;
  steps: FlowCloneStep[];
  errors: Array<{
    flowId: string;
    flowName: string;
    message: string;
    code?: string;
  }>;
  startedAt?: string;
  completedAt?: string;
}

/**
 * Response from flow clone job creation API
 */
export interface FlowCloneJobResponse {
  jobId: string;
  status: string;
  message: string;
}

/**
 * Job status response from polling endpoint
 */
export interface FlowCloneJobStatusResponse {
  jobId: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'paused' | 'cancelled' | 'detecting' | 'waiting_approval' | 'deleting';
  progress: {
    total: number;
    completed: number;
    failed: number;
  };
  steps: FlowCloneStep[];
  startedAt?: string;
  completedAt?: string;
  error?: string;
}
