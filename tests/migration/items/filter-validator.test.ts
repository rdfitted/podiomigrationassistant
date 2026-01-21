/**
 * Tests for filter validation utilities
 */

import { describe, it, expect } from '@jest/globals';
import {
  isValidDateFormat,
  validateFilters,
  validateDateField,
  validateDateRange,
} from '@/lib/migration/items/filter-validator';

describe('Filter Validator', () => {
  describe('isValidDateFormat', () => {
    describe('valid date-only formats', () => {
      it('should accept YYYY-MM-DD format', () => {
        expect(isValidDateFormat('2025-01-15')).toBe(true);
        expect(isValidDateFormat('2025-12-31')).toBe(true);
        expect(isValidDateFormat('2025-06-01')).toBe(true);
        expect(isValidDateFormat('2020-01-01')).toBe(true);
        expect(isValidDateFormat('2099-12-31')).toBe(true);
      });
    });

    describe('valid datetime with space separator', () => {
      it('should accept YYYY-MM-DD HH:mm:ss format', () => {
        expect(isValidDateFormat('2025-01-15 09:30:00')).toBe(true);
        expect(isValidDateFormat('2025-12-31 23:59:59')).toBe(true);
        expect(isValidDateFormat('2025-01-01 00:00:00')).toBe(true);
        expect(isValidDateFormat('2025-06-01 12:00:00')).toBe(true);
      });
    });

    describe('valid full ISO 8601 formats', () => {
      it('should accept ISO with T separator (no timezone)', () => {
        expect(isValidDateFormat('2025-01-15T09:30:00')).toBe(true);
        expect(isValidDateFormat('2025-12-31T23:59:59')).toBe(true);
        expect(isValidDateFormat('2025-01-01T00:00:00')).toBe(true);
      });

      it('should accept ISO with Z timezone', () => {
        expect(isValidDateFormat('2025-01-15T09:30:00Z')).toBe(true);
        expect(isValidDateFormat('2025-12-31T23:59:59Z')).toBe(true);
        expect(isValidDateFormat('2025-01-01T00:00:00Z')).toBe(true);
      });

      it('should accept ISO with +HH:mm timezone', () => {
        expect(isValidDateFormat('2025-01-15T09:30:00+00:00')).toBe(true);
        expect(isValidDateFormat('2025-12-31T23:59:59+05:30')).toBe(true);
        expect(isValidDateFormat('2025-01-01T00:00:00-08:00')).toBe(true);
      });
    });

    describe('invalid date formats', () => {
      it('should reject reversed date format (MM-DD-YYYY)', () => {
        expect(isValidDateFormat('01-15-2025')).toBe(false);
      });

      it('should reject slash-separated dates', () => {
        expect(isValidDateFormat('2025/01/15')).toBe(false);
      });

      it('should reject month names', () => {
        expect(isValidDateFormat('January 15, 2025')).toBe(false);
        expect(isValidDateFormat('15-Jan-2025')).toBe(false);
      });

      it('should reject single-digit months/days', () => {
        expect(isValidDateFormat('2025-1-15')).toBe(false);
        expect(isValidDateFormat('2025-01-5')).toBe(false);
      });

      it('should reject invalid dates', () => {
        expect(isValidDateFormat('2025-13-01')).toBe(false);
        expect(isValidDateFormat('2025-01-32')).toBe(false);
        expect(isValidDateFormat('2025-00-01')).toBe(false);
      });

      it('should reject random text', () => {
        expect(isValidDateFormat('random text')).toBe(false);
        expect(isValidDateFormat('')).toBe(false);
      });

      it('should reject partial datetime formats', () => {
        expect(isValidDateFormat('2025-01-15 09:30')).toBe(false);
        expect(isValidDateFormat('2025-01-15T09:30')).toBe(false);
      });

      it('should reject wrong timezone formats', () => {
        expect(isValidDateFormat('2025-01-15T09:30:00+00')).toBe(false);
        expect(isValidDateFormat('2025-01-15T09:30:00GMT')).toBe(false);
      });
    });

    describe('edge cases', () => {
      it('should handle null/undefined gracefully', () => {
        expect(isValidDateFormat(null as any)).toBe(false);
        expect(isValidDateFormat(undefined as any)).toBe(false);
      });

      it('should handle whitespace', () => {
        expect(isValidDateFormat('2025-01-15')).toBe(true);
        expect(isValidDateFormat(' 2025-01-15')).toBe(true);
        expect(isValidDateFormat('2025-01-15 ')).toBe(true);
        expect(isValidDateFormat(' 2025-01-15 ')).toBe(true);
      });
    });
  });

  describe('validateFilters', () => {
    describe('valid filters', () => {
      it('should return valid for null filters', () => {
        const result = validateFilters(null);
        expect(result.valid).toBe(true);
        expect(result.errors).toEqual([]);
      });

      it('should return valid for undefined filters', () => {
        const result = validateFilters(undefined);
        expect(result.valid).toBe(true);
        expect(result.errors).toEqual([]);
      });

      it('should return valid for empty filters', () => {
        const result = validateFilters({});
        expect(result.valid).toBe(true);
        expect(result.errors).toEqual([]);
      });

      it('should return valid for YYYY-MM-DD date format', () => {
        const filters = {
          createdFrom: '2025-01-01',
          createdTo: '2025-12-31',
        };
        const result = validateFilters(filters);
        expect(result.valid).toBe(true);
        expect(result.errors).toEqual([]);
      });

      it('should return valid for YYYY-MM-DD HH:mm:ss format', () => {
        const filters = {
          createdFrom: '2025-01-01 00:00:00',
          lastEditTo: '2025-12-31 23:59:59',
        };
        const result = validateFilters(filters);
        expect(result.valid).toBe(true);
        expect(result.errors).toEqual([]);
      });

      it('should return valid for full ISO 8601 formats', () => {
        const filters = {
          createdFrom: '2025-01-01T00:00:00Z',
          lastEditFrom: '2025-06-01T09:30:00+00:00',
          lastEditTo: '2025-12-31T23:59:59Z',
        };
        const result = validateFilters(filters);
        expect(result.valid).toBe(true);
        expect(result.errors).toEqual([]);
      });

      it('should return valid for tags array', () => {
        const filters = {
          tags: ['tag1', 'tag2'],
        };
        const result = validateFilters(filters);
        expect(result.valid).toBe(true);
        expect(result.errors).toEqual([]);
      });

      it('should return valid for mixed formats', () => {
        const filters = {
          createdFrom: '2025-01-01',
          createdTo: '2025-12-31 23:59:59',
          lastEditFrom: '2025-06-01T09:00:00Z',
          tags: ['urgent', 'active'],
        };
        const result = validateFilters(filters);
        expect(result.valid).toBe(true);
        expect(result.errors).toEqual([]);
      });
    });

    describe('invalid date formats', () => {
      it('should reject invalid createdFrom format', () => {
        const filters = {
          createdFrom: 'invalid-date',
        };
        const result = validateFilters(filters);
        expect(result.valid).toBe(false);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]).toContain('createdFrom');
        expect(result.errors[0]).toContain('ISO 8601');
      });

      it('should reject invalid createdTo format', () => {
        const filters = {
          createdTo: '2025/01/15',
        };
        const result = validateFilters(filters);
        expect(result.valid).toBe(false);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]).toContain('createdTo');
      });

      it('should reject invalid lastEditFrom format', () => {
        const filters = {
          lastEditFrom: 'Jan 1, 2025',
        };
        const result = validateFilters(filters);
        expect(result.valid).toBe(false);
        expect(result.errors[0]).toContain('lastEditFrom');
      });

      it('should reject invalid lastEditTo format', () => {
        const filters = {
          lastEditTo: '2025-1-1',
        };
        const result = validateFilters(filters);
        expect(result.valid).toBe(false);
        expect(result.errors[0]).toContain('lastEditTo');
      });
    });

    describe('date range validation', () => {
      it('should reject createdFrom after createdTo', () => {
        const filters = {
          createdFrom: '2025-12-31',
          createdTo: '2025-01-01',
        };
        const result = validateFilters(filters);
        expect(result.valid).toBe(false);
        expect(result.errors[0]).toContain('must be before or equal to');
        expect(result.errors[0]).toContain('created');
      });

      it('should reject lastEditFrom after lastEditTo', () => {
        const filters = {
          lastEditFrom: '2025-06-30',
          lastEditTo: '2025-06-01',
        };
        const result = validateFilters(filters);
        expect(result.valid).toBe(false);
        expect(result.errors[0]).toContain('must be before or equal to');
        expect(result.errors[0]).toContain('lastEdit');
      });

      it('should allow same date for from and to', () => {
        const filters = {
          createdFrom: '2025-06-15',
          createdTo: '2025-06-15',
        };
        const result = validateFilters(filters);
        expect(result.valid).toBe(true);
      });

      it('should allow datetime comparison across formats', () => {
        const filters = {
          createdFrom: '2025-06-15',
          createdTo: '2025-06-15 23:59:59',
        };
        const result = validateFilters(filters);
        expect(result.valid).toBe(true);
      });
    });

    describe('tags validation', () => {
      it('should reject non-array tags', () => {
        const filters = {
          tags: 'not-an-array' as any,
        };
        const result = validateFilters(filters);
        expect(result.valid).toBe(false);
        expect(result.errors[0]).toContain('must be an array');
      });

      it('should reject empty string tags', () => {
        const filters = {
          tags: ['valid', '', 'also-valid'],
        };
        const result = validateFilters(filters);
        expect(result.valid).toBe(false);
        expect(result.errors[0]).toContain('non-empty strings');
      });

      it('should reject whitespace-only tags', () => {
        const filters = {
          tags: ['valid', '   ', 'also-valid'],
        };
        const result = validateFilters(filters);
        expect(result.valid).toBe(false);
        expect(result.errors[0]).toContain('non-empty strings');
      });
    });

    describe('multiple errors', () => {
      it('should collect all validation errors', () => {
        const filters = {
          createdFrom: 'bad-date-1',
          createdTo: 'bad-date-2',
          lastEditFrom: 'bad-date-3',
          lastEditTo: 'bad-date-4',
        };
        const result = validateFilters(filters);
        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThanOrEqual(4);
      });

      it('should collect both format and range errors', () => {
        const filters = {
          createdFrom: '2025-12-31',
          createdTo: '2025-01-01',
          lastEditFrom: 'bad-date',
        };
        const result = validateFilters(filters);
        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThanOrEqual(2);
      });
    });
  });

  describe('validateDateField', () => {
    it('should validate a single valid date field', () => {
      const result = validateDateField('testField', '2025-01-15');
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should reject a single invalid date field', () => {
      const result = validateDateField('testField', 'invalid-date');
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('testField');
    });

    it('should accept full ISO 8601 format', () => {
      const result = validateDateField('testField', '2025-01-15T09:30:00Z');
      expect(result.valid).toBe(true);
    });
  });

  describe('validateDateRange', () => {
    it('should validate valid date range with both dates', () => {
      const result = validateDateRange('test', '2025-01-01', '2025-12-31');
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should validate range with only from date', () => {
      const result = validateDateRange('test', '2025-01-01', undefined);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should validate range with only to date', () => {
      const result = validateDateRange('test', undefined, '2025-12-31');
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should reject invalid from date format', () => {
      const result = validateDateRange('test', 'bad-date', '2025-12-31');
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('testFrom');
    });

    it('should reject invalid to date format', () => {
      const result = validateDateRange('test', '2025-01-01', 'bad-date');
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('testTo');
    });

    it('should reject from date after to date', () => {
      const result = validateDateRange('test', '2025-12-31', '2025-01-01');
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('must be before or equal to');
    });

    it('should allow same date for from and to', () => {
      const result = validateDateRange('test', '2025-06-15', '2025-06-15');
      expect(result.valid).toBe(true);
    });
  });
});
