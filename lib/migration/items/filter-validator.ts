/**
 * Filter validation utilities for item migrations
 * Validates filter inputs before conversion to Podio API format
 */

import { ItemMigrationFilters } from './types';

/**
 * Validation result for filter validation
 */
export interface FilterValidationResult {
  valid: boolean;
  errors: string[];
}

const DATE_FORMAT_HINT =
  'Expected ISO 8601 format (e.g., "2025-01-01", "2025-01-01 09:30:00", "2025-01-01T09:30:00", "2025-01-01T09:30:00Z", or "2025-01-01T09:30:00+00:00")';

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  switch (month) {
    case 2:
      return isLeapYear(year) ? 29 : 28;
    case 4:
    case 6:
    case 9:
    case 11:
      return 30;
    default:
      return 31;
  }
}

function parseIsoLikeDateToTimestamp(dateStr: string): number | null {
  const trimmed = dateStr.trim();
  if (!trimmed) {
    return null;
  }

  // Date only: YYYY-MM-DD
  let match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);

    if (month < 1 || month > 12) return null;
    const maxDay = daysInMonth(year, month);
    if (day < 1 || day > maxDay) return null;

    return Date.UTC(year, month - 1, day, 0, 0, 0);
  }

  // Date and time (space): YYYY-MM-DD HH:mm:ss
  match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(trimmed);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const hour = Number(match[4]);
    const minute = Number(match[5]);
    const second = Number(match[6]);

    if (month < 1 || month > 12) return null;
    const maxDay = daysInMonth(year, month);
    if (day < 1 || day > maxDay) return null;
    if (hour < 0 || hour > 23) return null;
    if (minute < 0 || minute > 59) return null;
    if (second < 0 || second > 59) return null;

    return Date.UTC(year, month - 1, day, hour, minute, second);
  }

  // Full ISO 8601 without timezone: YYYY-MM-DDTHH:mm:ss
  match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(trimmed);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const hour = Number(match[4]);
    const minute = Number(match[5]);
    const second = Number(match[6]);

    if (month < 1 || month > 12) return null;
    const maxDay = daysInMonth(year, month);
    if (day < 1 || day > maxDay) return null;
    if (hour < 0 || hour > 23) return null;
    if (minute < 0 || minute > 59) return null;
    if (second < 0 || second > 59) return null;

    // Treat as UTC if no timezone is provided
    return Date.UTC(year, month - 1, day, hour, minute, second);
  }

  // Full ISO 8601 with timezone: YYYY-MM-DDTHH:mm:ssZ or YYYY-MM-DDTHH:mm:ss+00:00
  match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(Z|([+-])(\d{2}):(\d{2}))$/.exec(trimmed);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const hour = Number(match[4]);
    const minute = Number(match[5]);
    const second = Number(match[6]);
    const tzZuluOrWholeOffset = match[7];
    const offsetSign = match[8];
    const offsetHours = match[9];
    const offsetMinutes = match[10];

    if (month < 1 || month > 12) return null;
    const maxDay = daysInMonth(year, month);
    if (day < 1 || day > maxDay) return null;
    if (hour < 0 || hour > 23) return null;
    if (minute < 0 || minute > 59) return null;
    if (second < 0 || second > 59) return null;

    const baseUtc = Date.UTC(year, month - 1, day, hour, minute, second);

    if (tzZuluOrWholeOffset === 'Z') {
      return baseUtc;
    }

    const offsetH = Number(offsetHours);
    const offsetM = Number(offsetMinutes);
    if (offsetH < 0 || offsetH > 23) return null;
    if (offsetM < 0 || offsetM > 59) return null;

    const offsetTotalMinutes = offsetH * 60 + offsetM;
    const offsetMultiplier = offsetSign === '+' ? 1 : -1;

    return baseUtc - offsetMultiplier * offsetTotalMinutes * 60_000;
  }

  return null;
}

/**
 * Validate ISO 8601 date format
 * Accepts:
 * - Full ISO with timezone: YYYY-MM-DDTHH:mm:ssZ or YYYY-MM-DDTHH:mm:ss+00:00
 * - Full ISO without timezone: YYYY-MM-DDTHH:mm:ss
 * - Date only: YYYY-MM-DD
 * - Date and time (space separated): YYYY-MM-DD HH:mm:ss
 *
 * @param dateStr - Date string to validate
 * @returns true if valid ISO 8601 date format
 */
export function isValidDateFormat(dateStr: unknown): boolean {
  if (typeof dateStr !== 'string') {
    return false;
  }

  return parseIsoLikeDateToTimestamp(dateStr) !== null;
}

/**
 * Validate item migration filters
 * Checks:
 * - Date formats are valid ISO 8601
 * - Date ranges are logical (from <= to)
 * - Tags array is valid
 *
 * @param filters - Filters to validate
 * @returns Validation result with errors if any
 */
export function validateFilters(
  filters: ItemMigrationFilters | undefined | null
): FilterValidationResult {
  const errors: string[] = [];

  if (!filters) {
    return { valid: true, errors: [] };
  }

  errors.push(
    ...validateDateRange('created', filters.createdFrom, filters.createdTo).errors,
    ...validateDateRange('lastEdit', filters.lastEditFrom, filters.lastEditTo).errors
  );

  // Validate tags array
  if (filters.tags) {
    if (!Array.isArray(filters.tags)) {
      errors.push('tags must be an array of strings');
    } else {
      const invalidTags = filters.tags.filter(
        tag => typeof tag !== 'string' || tag.trim() === ''
      );
      if (invalidTags.length > 0) {
        errors.push('Invalid tags found: tags must be non-empty strings');
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate a single date field
 * Useful for individual field validation
 *
 * @param fieldName - Name of the field (for error messages)
 * @param dateValue - Date value to validate
 * @returns Validation result
 */
export function validateDateField(
  fieldName: string,
  dateValue: string
): FilterValidationResult {
  if (!isValidDateFormat(dateValue)) {
    return {
      valid: false,
      errors: [
        `Invalid ${fieldName} date format: "${dateValue}". ` +
        DATE_FORMAT_HINT
      ],
    };
  }
  return { valid: true, errors: [] };
}

/**
 * Validate date range (from and to fields)
 *
 * @param fieldName - Name of the field (e.g., "created", "lastEdit")
 * @param fromValue - Start date value
 * @param toValue - End date value
 * @returns Validation result
 */
export function validateDateRange(
  fieldName: string,
  fromValue: unknown,
  toValue: unknown
): FilterValidationResult {
  const errors: string[] = [];

  const fromProvided = fromValue !== undefined && fromValue !== null && String(fromValue).trim() !== '';
  const toProvided = toValue !== undefined && toValue !== null && String(toValue).trim() !== '';

  let fromTimestamp: number | undefined;
  let toTimestamp: number | undefined;

  if (fromProvided) {
    if (typeof fromValue !== 'string') {
      errors.push(`Invalid ${fieldName}From date format: "${String(fromValue)}". ${DATE_FORMAT_HINT}`);
    } else {
      const ts = parseIsoLikeDateToTimestamp(fromValue);
      if (ts === null) {
        errors.push(`Invalid ${fieldName}From date format: "${fromValue}". ${DATE_FORMAT_HINT}`);
      } else {
        fromTimestamp = ts;
      }
    }
  }

  if (toProvided) {
    if (typeof toValue !== 'string') {
      errors.push(`Invalid ${fieldName}To date format: "${String(toValue)}". ${DATE_FORMAT_HINT}`);
    } else {
      const ts = parseIsoLikeDateToTimestamp(toValue);
      if (ts === null) {
        errors.push(`Invalid ${fieldName}To date format: "${toValue}". ${DATE_FORMAT_HINT}`);
      } else {
        toTimestamp = ts;
      }
    }
  }

  // Only check range logic if both dates are provided and valid
  if (fromTimestamp !== undefined && toTimestamp !== undefined && fromTimestamp > toTimestamp) {
    errors.push(
      `${fieldName}From (${String(fromValue)}) must be before or equal to ${fieldName}To (${String(toValue)})`
    );
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
