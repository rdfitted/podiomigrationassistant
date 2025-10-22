/**
 * Duplicate cleanup types and interfaces
 * Defines data models for duplicate cleanup jobs, detection, and deletion
 */

/**
 * Cleanup mode determines how duplicates are handled
 */
export type CleanupMode = 'manual' | 'automated';

/**
 * Strategy for selecting which duplicate to keep
 */
export type KeepStrategy = 'oldest' | 'newest' | 'manual';

/**
 * A single item in a duplicate group
 */
export interface DuplicateItem {
  itemId: number;
  title: string;
  createdOn: string;
  lastEditOn: string;
  matchValue: string; // The value that caused it to be identified as a duplicate
  fieldValues?: Record<string, any>; // Preview of key fields
}

/**
 * A group of duplicate items
 */
export interface DuplicateGroup {
  matchValue: string; // The value they all share
  items: DuplicateItem[];
  keepItemId?: number; // Which item to keep (null if not yet selected)
  deleteItemIds?: number[]; // Which items to delete
  approved?: boolean; // Whether user approved this group for deletion
}

/**
 * Cleanup request payload
 */
export interface CleanupRequestPayload {
  appId: number; // The app to clean up (source and target are the same)
  matchField: string; // Field external_id to match on
  mode: CleanupMode; // 'manual' or 'automated'
  keepStrategy?: KeepStrategy; // 'oldest', 'newest', or 'manual' (default: 'oldest')
  dryRun?: boolean; // Preview mode without actual deletions
  maxGroups?: number; // Maximum number of duplicate groups to process (for testing)
  batchSize?: number; // Items to delete per batch (default: 100)
  concurrency?: number; // Parallel deletion batches (default: 3)
  approvedGroups?: DuplicateGroup[]; // For manual mode: user-approved groups to delete
}

/**
 * Cleanup job metadata
 */
export interface CleanupJobMetadata {
  appId: number;
  matchField: string;
  mode: CleanupMode;
  keepStrategy: KeepStrategy;
  batchSize: number;
  concurrency: number;
}

/**
 * Cleanup job
 */
export interface CleanupJob {
  id: string;
  jobType: 'cleanup';
  appId: number;
  matchField: string;
  mode: CleanupMode;
  keepStrategy: KeepStrategy;
  status: 'planning' | 'detecting' | 'waiting_approval' | 'deleting' | 'completed' | 'failed' | 'paused' | 'cancelled';
  progress?: {
    totalGroups: number; // Total duplicate groups found
    processedGroups: number; // Groups processed
    totalItemsToDelete: number; // Total items marked for deletion
    deletedItems: number; // Items successfully deleted
    failedDeletions: number; // Items that failed to delete
    percent: number;
    lastUpdate: Date;
  };
  duplicateGroups?: DuplicateGroup[]; // Found duplicate groups (for manual mode)
  startedAt: Date;
  completedAt?: Date;
  errors?: Array<{
    itemId?: number;
    message: string;
    code?: string;
    timestamp: Date;
  }>;
}

/**
 * Cleanup status response
 */
export interface CleanupStatusResponse {
  jobId: string;
  status: 'planning' | 'detecting' | 'waiting_approval' | 'deleting' | 'completed' | 'failed' | 'paused' | 'cancelled';
  mode: CleanupMode;
  keepStrategy: KeepStrategy;
  progress: {
    totalGroups: number;
    processedGroups: number;
    totalItemsToDelete: number;
    deletedItems: number;
    failedDeletions: number;
    percent: number;
    lastUpdate: string;
  };
  duplicateGroups?: DuplicateGroup[]; // For manual mode or dry-run
  throughput?: {
    itemsPerSecond: number;
    batchesPerMinute: number;
    avgBatchDuration: number;
    estimatedCompletionTime?: string;
  };
  errors: Array<{
    itemId?: number;
    message: string;
    code?: string;
    timestamp: string;
  }>;
  startedAt: string;
  completedAt?: string;
}

/**
 * Cleanup result
 */
export interface CleanupResult {
  jobId: string;
  totalGroups: number;
  totalItemsDeleted: number;
  failedDeletions: number;
  errors: Array<{
    itemId?: number;
    message: string;
    code?: string;
  }>;
}

/**
 * Dry-run preview for cleanup
 */
export interface CleanupDryRunPreview {
  totalGroups: number;
  totalItemsToDelete: number;
  duplicateGroups: DuplicateGroup[];
  summary: {
    totalSourceItems: number;
    uniqueItems: number;
    duplicateItems: number;
    groupsWithDuplicates: number;
  };
}
