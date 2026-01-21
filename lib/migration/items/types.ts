/**
 * Item migration types and interfaces
 * Defines data models for item migration jobs, requests, and progress tracking
 */

/**
 * Item migration mode
 */
export type ItemMigrationMode = 'create' | 'update' | 'upsert';

/**
 * Failed item record for retry functionality
 */
export interface FailedItemRecord {
  sourceItemId: number;
  error: string;
  timestamp: string;
}

/**
 * Field mapping for item migration
 * Maps source field IDs to target field IDs
 */
export type FieldMapping = Record<string, string>;

/**
 * Item migration filters for date-based and tag-based filtering
 *
 * These filters allow restricting which items are included in a migration
 * based on creation date, last edit date, or tags.
 *
 * Date formats accepted (ISO 8601):
 * - Date only: `YYYY-MM-DD` (e.g., "2025-01-15")
 * - Date and time (space): `YYYY-MM-DD HH:mm:ss` (e.g., "2025-01-15 09:30:00")
 * - Full ISO with T: `YYYY-MM-DDTHH:mm:ss` (e.g., "2025-01-15T09:30:00")
 * - Full ISO with timezone: `YYYY-MM-DDTHH:mm:ssZ` or `YYYY-MM-DDTHH:mm:ss+00:00`
 *
 * @example
 * ```typescript
 * // Filter items created in 2025
 * const filters: ItemMigrationFilters = {
 *   createdFrom: '2025-01-01',
 *   createdTo: '2025-12-31',
 * };
 * ```
 *
 * @example
 * ```typescript
 * // Filter items modified after a specific date
 * const filters: ItemMigrationFilters = {
 *   lastEditFrom: '2025-06-01',
 * };
 * ```
 *
 * @example
 * ```typescript
 * // Filter items by tags
 * const filters: ItemMigrationFilters = {
 *   tags: ['urgent', 'client-project'],
 * };
 * ```
 *
 * @example
 * ```typescript
 * // Combined filters (all conditions must be met)
 * const filters: ItemMigrationFilters = {
 *   createdFrom: '2025-01-01',
 *   lastEditTo: '2025-06-30',
 *   tags: ['active'],
 * };
 * ```
 */
export interface ItemMigrationFilters {
  /**
   * Filter items created on or after this date (inclusive)
   * Format: ISO 8601 (e.g., "2025-01-01", "2025-01-01 09:30:00", or "2025-01-01T09:30:00Z")
   */
  createdFrom?: string;

  /**
   * Filter items created on or before this date (inclusive)
   * Format: ISO 8601 (e.g., "2025-01-01", "2025-01-01 09:30:00", or "2025-01-01T09:30:00Z")
   */
  createdTo?: string;

  /**
   * Filter items last edited on or after this date (inclusive)
   * Maps to Podio's `last_event_on` filter
   * Format: ISO 8601 (e.g., "2025-01-01", "2025-01-01 09:30:00", or "2025-01-01T09:30:00Z")
   */
  lastEditFrom?: string;

  /**
   * Filter items last edited on or before this date (inclusive)
   * Maps to Podio's `last_event_on` filter
   * Format: ISO 8601 (e.g., "2025-01-01", "2025-01-01 09:30:00", or "2025-01-01T09:30:00Z")
   */
  lastEditTo?: string;

  /**
   * Filter items that have all specified tags
   * Tags are case-sensitive
   */
  tags?: string[];
}

/**
 * Resumption configuration for multi-session migrations
 * Allows migrations to resume from a specific point
 */
export interface ResumptionConfig {
  /** Sort field used for consistent ordering (item_id, last_event_on, created_on) */
  sortBy?: string;
  /** Sort in descending order */
  sortDesc?: boolean;
  /** Last processed item ID (for item_id-based resumption) */
  lastProcessedItemId?: number;
  /** Last processed timestamp (for date-based resumption) */
  lastProcessedTimestamp?: string;
  /** Offset to resume from (calculated automatically if not provided) */
  offset?: number;
  /** Whether user manually overrode the resume point */
  userOverride?: boolean;
}

/**
 * Item migration job metadata
 */
export interface ItemMigrationJobMetadata {
  sourceAppId: number;
  targetAppId: number;
  mode: ItemMigrationMode;
  fieldMapping: FieldMapping;
  batchSize?: number;
  concurrency?: number;
  filters?: ItemMigrationFilters;
  resumeToken?: string;
  /** Resumption configuration for multi-session migrations */
  resumption?: ResumptionConfig;
}

/**
 * Item migration request payload
 */
export interface ItemMigrationRequestPayload {
  sourceAppId: number;
  targetAppId: number;
  mode?: ItemMigrationMode;
  sourceMatchField?: string; // Source field external_id to extract value from for matching
  targetMatchField?: string; // Target field external_id to search by for matching
  duplicateBehavior?: 'skip' | 'error' | 'update'; // How to handle duplicates when match fields are set
  fieldMapping?: FieldMapping;
  batchSize?: number;
  concurrency?: number;
  stopOnError?: boolean;
  filters?: ItemMigrationFilters;
  resumeToken?: string;
  maxItems?: number; // Maximum number of items to migrate (for testing)
  dryRun?: boolean; // Dry-run mode: preview changes without executing (CREATE, UPDATE, and UPSERT modes)
  transferFiles?: boolean; // Transfer files from source to destination (UPDATE/UPSERT modes only)
  /** Resumption configuration for multi-session migrations */
  resumption?: ResumptionConfig;
}

/**
 * Item migration job (extends MigrationJob from state-store)
 */
export interface ItemMigrationJob {
  id: string;
  jobType: 'item_migration';
  sourceAppId: number;
  targetAppId: number;
  mode: ItemMigrationMode;
  fieldMapping: FieldMapping;
  status: 'planning' | 'in_progress' | 'completed' | 'failed';
  progress?: {
    total: number;
    processed: number;
    successful: number;
    failed: number;
    percent: number;
    lastUpdate: Date;
  };
  startedAt: Date;
  completedAt?: Date;
  errors?: Array<{
    itemId?: string;
    message: string;
    code?: string;
    timestamp: Date;
  }>;
  resumeToken?: string;
  /** Resumption configuration for multi-session migrations */
  resumption?: ResumptionConfig;
  /** Failed items for retry functionality */
  failedItems?: FailedItemRecord[];
  /** Number of retry attempts made */
  retryAttempts?: number;
  /** Timestamp of last retry attempt */
  lastRetryTimestamp?: string;
}

/**
 * Item migration status response
 */
export interface ItemMigrationStatusResponse {
  jobId: string;
  status: 'planning' | 'in_progress' | 'completed' | 'failed' | 'paused' | 'cancelled';
  mode: 'create' | 'update' | 'upsert';
  progress: {
    total: number;
    processed: number;
    successful: number;
    duplicatesSkipped?: number;
    duplicatesUpdated?: number;
    failed: number;
    percent: number;
    lastUpdate: string;
  };
  /** Real-time throughput and performance metrics */
  throughput?: {
    itemsPerSecond: number;
    batchesPerMinute: number;
    avgBatchDuration: number;
    estimatedCompletionTime?: string;
    rateLimitPauses: number;
    totalRateLimitDelay: number;
  };
  errors: Array<{
    itemId?: string;
    message: string;
    code?: string;
    timestamp: string;
  }>;
  /** Error statistics by category */
  errorsByCategory?: Record<string, {
    count: number;
    percentage: number;
    shouldRetry: boolean;
  }>;
  resumeToken?: string;
  canResume: boolean;
  startedAt: string;
  completedAt?: string;
  /** Current resumption state (where migration will resume from) */
  resumption?: ResumptionConfig;
  /** Failed items for retry functionality */
  failedItems?: FailedItemRecord[];
  /** Number of retry attempts made */
  retryAttempts?: number;
  /** Timestamp of last retry attempt */
  lastRetryTimestamp?: string;
  /** Snapshot of progress before retry was initiated (for displaying previous run state) */
  preRetrySnapshot?: {
    total: number;
    processed: number;
    successful: number;
    failed: number;
    percent: number;
    lastUpdate: string;
  };
}

/**
 * Item migration progress event (for SSE)
 */
export interface ItemMigrationProgressEvent {
  type: 'progress' | 'error' | 'completed' | 'failed';
  jobId: string;
  progress?: {
    total: number;
    processed: number;
    successful: number;
    failed: number;
    percent: number;
    throughput?: number; // items per second
    eta?: number; // seconds remaining
  };
  error?: {
    itemId?: string;
    message: string;
    code?: string;
  };
  timestamp: string;
}

/**
 * Item migration service result
 */
export interface ItemMigrationResult {
  jobId: string;
  total: number;
  successful: number;
  failed: number;
  errors: Array<{
    itemId?: string;
    message: string;
    code?: string;
  }>;
  resumeToken?: string;
}
