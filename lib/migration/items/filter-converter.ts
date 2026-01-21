/**
 * Filter conversion utilities for item migrations
 * Converts user-friendly filter format to Podio API format
 */

import { ItemMigrationFilters } from './types';
import { logger } from '../logging';
import { validateFilters, isValidDateFormat } from './filter-validator';

export { validateFilters, isValidDateFormat };

/**
 * Podio API filter format for date ranges
 */
interface PodioDateRange {
  from?: string;
  to?: string;
}

const USER_FRIENDLY_FILTER_KEYS = ['createdFrom', 'createdTo', 'lastEditFrom', 'lastEditTo'] as const;

function buildDateRange(from?: string, to?: string): PodioDateRange | undefined {
  if (!from && !to) {
    return undefined;
  }

  return {
    ...(from && { from }),
    ...(to && { to }),
  };
}

/**
 * Podio API filters format
 */
export interface PodioFilters {
  created_on?: PodioDateRange;
  last_event_on?: PodioDateRange;
  tags?: string[];
  [key: string]: unknown;
}

/**
 * Convert user-friendly item migration filters to Podio API format
 *
 * Converts:
 * - `createdFrom`/`createdTo` → `created_on: { from, to }`
 * - `lastEditFrom`/`lastEditTo` → `last_event_on: { from, to }`
 * - `tags` array is passed through as-is
 *
 * @param filters - User-friendly filter format from ItemMigrationFilters
 * @returns Podio API filter format (Record<string, unknown>)
 *
 * @example
 * ```typescript
 * // Input: User-friendly format
 * const userFilters = {
 *   createdFrom: '2025-01-01',
 *   createdTo: '2025-12-31',
 *   tags: ['urgent', 'client']
 * };
 *
 * // Output: Podio API format
 * const podioFilters = convertFilters(userFilters);
 * // {
 * //   created_on: { from: '2025-01-01', to: '2025-12-31' },
 * //   tags: ['urgent', 'client']
 * // }
 * ```
 *
 * @example
 * ```typescript
 * // Partial date ranges are supported
 * const fromOnlyFilters = { createdFrom: '2025-06-01' };
 * // Output: { created_on: { from: '2025-06-01' } }
 *
 * const toOnlyFilters = { lastEditTo: '2025-12-31' };
 * // Output: { last_event_on: { to: '2025-12-31' } }
 * ```
 */
export function convertFilters(
  filters: ItemMigrationFilters | undefined | null
): Record<string, unknown> {
  if (!filters) {
    logger.debug('No filters provided, returning empty object');
    return {};
  }

  // Normalize whitespace and treat blank strings as "not provided"
  const createdFrom = filters.createdFrom?.trim() || undefined;
  const createdTo = filters.createdTo?.trim() || undefined;
  const lastEditFrom = filters.lastEditFrom?.trim() || undefined;
  const lastEditTo = filters.lastEditTo?.trim() || undefined;

  const tags = filters.tags?.map(tag => tag.trim()).filter(tag => tag.length > 0);

  const podioFilters: PodioFilters = {};

  // Convert created date range (createdFrom/createdTo → created_on)
  const createdOnRange = buildDateRange(createdFrom, createdTo);
  if (createdOnRange) {
    podioFilters.created_on = createdOnRange;
    logger.debug('Applied created_on filter', {
      from: createdFrom,
      to: createdTo,
    });
  }

  // Convert last edit date range (lastEditFrom/lastEditTo → last_event_on)
  const lastEventOnRange = buildDateRange(lastEditFrom, lastEditTo);
  if (lastEventOnRange) {
    podioFilters.last_event_on = lastEventOnRange;
    logger.debug('Applied last_event_on filter', {
      from: lastEditFrom,
      to: lastEditTo,
    });
  }

  // Pass through tags array as-is
  if (tags?.length) {
    podioFilters.tags = tags;
    logger.debug('Applied tags filter', {
      tags,
    });
  }

  const hasFilters = Object.keys(podioFilters).length > 0;
  if (hasFilters) {
    logger.debug('Converted item migration filters to Podio format', {
      inputFilters: {
        createdFrom,
        createdTo,
        lastEditFrom,
        lastEditTo,
        tagCount: tags?.length || 0,
      },
      outputFilters: podioFilters,
    });
  }

  return podioFilters;
}

/**
 * Build Podio API filter payload from a mixed filter input.
 *
 * - Preserves any existing Podio filter keys already present in `filters`
 * - Converts user-friendly keys (`createdFrom`, `createdTo`, `lastEditFrom`, `lastEditTo`, `tags`)
 *   into Podio API format (`created_on`, `last_event_on`, `tags`)
 * - Removes the user-friendly keys from the returned object to avoid leaking unknown keys to the API
 *
 * @param filters - Base filter object (may contain Podio filters and/or user-friendly keys)
 * @param overrides - Explicit user-friendly filter values (take precedence over values in `filters`)
 * @throws Error if user-friendly filters fail validation
 */
export function buildPodioItemFilters(
  filters: Record<string, unknown> | undefined | null,
  overrides?: Partial<ItemMigrationFilters>
): Record<string, unknown> {
  const baseFilters: Record<string, unknown> = { ...(filters ?? {}) };

  for (const key of USER_FRIENDLY_FILTER_KEYS) {
    delete (baseFilters as any)[key];
  }

  const userFriendly = {
    createdFrom: overrides?.createdFrom ?? (filters as any)?.createdFrom,
    createdTo: overrides?.createdTo ?? (filters as any)?.createdTo,
    lastEditFrom: overrides?.lastEditFrom ?? (filters as any)?.lastEditFrom,
    lastEditTo: overrides?.lastEditTo ?? (filters as any)?.lastEditTo,
    tags: overrides?.tags ?? (filters as any)?.tags,
  } as ItemMigrationFilters;

  const validation = validateFilters(userFriendly);
  if (!validation.valid) {
    throw new Error(`Invalid filters: ${validation.errors.join('; ')}`);
  }

  const converted = convertFilters(userFriendly);
  return {
    ...baseFilters,
    ...converted,
  };
}
