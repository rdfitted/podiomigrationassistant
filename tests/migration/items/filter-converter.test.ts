/**
 * Tests for filter conversion utilities
 */

import { describe, it, expect } from '@jest/globals';
import {
  convertFilters,
  buildPodioItemFilters,
  validateFilters,
  isValidDateFormat,
} from '@/lib/migration/items/filter-converter';

describe('Filter Converter', () => {
  describe('convertFilters', () => {
    describe('null/undefined handling', () => {
      it('should return empty object for null filters', () => {
        expect(convertFilters(null)).toEqual({});
      });

      it('should return empty object for undefined filters', () => {
        expect(convertFilters(undefined)).toEqual({});
      });

      it('should return empty object for empty filters', () => {
        expect(convertFilters({})).toEqual({});
      });
    });

    describe('created date conversion', () => {
      it('should convert createdFrom to created_on.from', () => {
        const filters = {
          createdFrom: '2025-01-01',
        };
        expect(convertFilters(filters)).toEqual({
          created_on: { from: '2025-01-01' },
        });
      });

      it('should convert createdTo to created_on.to', () => {
        const filters = {
          createdTo: '2025-12-31',
        };
        expect(convertFilters(filters)).toEqual({
          created_on: { to: '2025-12-31' },
        });
      });

      it('should convert both createdFrom and createdTo', () => {
        const filters = {
          createdFrom: '2025-01-01',
          createdTo: '2025-12-31',
        };
        expect(convertFilters(filters)).toEqual({
          created_on: {
            from: '2025-01-01',
            to: '2025-12-31',
          },
        });
      });

      it('should handle datetime format', () => {
        const filters = {
          createdFrom: '2025-01-01 09:00:00',
          createdTo: '2025-12-31 17:00:00',
        };
        expect(convertFilters(filters)).toEqual({
          created_on: {
            from: '2025-01-01 09:00:00',
            to: '2025-12-31 17:00:00',
          },
        });
      });
    });

    describe('last edit date conversion', () => {
      it('should convert lastEditFrom to last_event_on.from', () => {
        const filters = {
          lastEditFrom: '2025-06-01',
        };
        expect(convertFilters(filters)).toEqual({
          last_event_on: { from: '2025-06-01' },
        });
      });

      it('should convert lastEditTo to last_event_on.to', () => {
        const filters = {
          lastEditTo: '2025-06-30',
        };
        expect(convertFilters(filters)).toEqual({
          last_event_on: { to: '2025-06-30' },
        });
      });

      it('should convert both lastEditFrom and lastEditTo', () => {
        const filters = {
          lastEditFrom: '2025-06-01',
          lastEditTo: '2025-06-30',
        };
        expect(convertFilters(filters)).toEqual({
          last_event_on: {
            from: '2025-06-01',
            to: '2025-06-30',
          },
        });
      });
    });

    describe('tags pass-through', () => {
      it('should pass through tags array as-is', () => {
        const filters = {
          tags: ['urgent', 'client-project'],
        };
        expect(convertFilters(filters)).toEqual({
          tags: ['urgent', 'client-project'],
        });
      });

      it('should not include empty tags array', () => {
        const filters = {
          tags: [],
        };
        expect(convertFilters(filters)).toEqual({});
      });

      it('should handle single tag', () => {
        const filters = {
          tags: ['important'],
        };
        expect(convertFilters(filters)).toEqual({
          tags: ['important'],
        });
      });
    });

    describe('merged filters', () => {
      it('should convert date filters and tags together', () => {
        const filters = {
          createdFrom: '2025-01-01',
          createdTo: '2025-12-31',
          tags: ['active'],
        };
        expect(convertFilters(filters)).toEqual({
          created_on: {
            from: '2025-01-01',
            to: '2025-12-31',
          },
          tags: ['active'],
        });
      });

      it('should convert all filter types together', () => {
        const filters = {
          createdFrom: '2025-01-01',
          createdTo: '2025-06-30',
          lastEditFrom: '2025-04-01',
          lastEditTo: '2025-06-30',
          tags: ['urgent', 'active'],
        };
        expect(convertFilters(filters)).toEqual({
          created_on: {
            from: '2025-01-01',
            to: '2025-06-30',
          },
          last_event_on: {
            from: '2025-04-01',
            to: '2025-06-30',
          },
          tags: ['urgent', 'active'],
        });
      });
    });
  });

  describe('isValidDateFormat', () => {
    it('should accept YYYY-MM-DD format', () => {
      expect(isValidDateFormat('2025-01-15')).toBe(true);
      expect(isValidDateFormat('2025-12-31')).toBe(true);
    });

    it('should accept YYYY-MM-DD HH:mm:ss format', () => {
      expect(isValidDateFormat('2025-01-15 09:30:00')).toBe(true);
      expect(isValidDateFormat('2025-12-31 23:59:59')).toBe(true);
    });

    it('should accept full ISO 8601 formats', () => {
      expect(isValidDateFormat('2025-01-15T09:30:00')).toBe(true);
      expect(isValidDateFormat('2025-01-15T09:30:00Z')).toBe(true);
      expect(isValidDateFormat('2025-01-15T09:30:00+00:00')).toBe(true);
      expect(isValidDateFormat('2025-01-15T09:30:00-08:00')).toBe(true);
    });

    it('should reject invalid date formats', () => {
      expect(isValidDateFormat('01-15-2025')).toBe(false);
      expect(isValidDateFormat('2025/01/15')).toBe(false);
      expect(isValidDateFormat('January 15, 2025')).toBe(false);
      expect(isValidDateFormat('2025-1-15')).toBe(false);
      expect(isValidDateFormat('2025-13-01')).toBe(false);
      expect(isValidDateFormat('2025-01-32')).toBe(false);
      expect(isValidDateFormat('random text')).toBe(false);
    });

    it('should reject partial datetime formats', () => {
      expect(isValidDateFormat('2025-01-15 09:30')).toBe(false);
      expect(isValidDateFormat('2025-01-15T09:30')).toBe(false);
    });
  });

  describe('buildPodioItemFilters', () => {
    it('should preserve existing Podio filters', () => {
      const input = {
        created_on: { from: '2025-01-01', to: '2025-12-31' },
      };
      expect(buildPodioItemFilters(input)).toEqual(input);
    });

    it('should convert user-friendly date keys inside filters', () => {
      const input = {
        createdFrom: '2025-01-01',
        createdTo: '2025-12-31',
        other_key: 'keep-me',
      };
      expect(buildPodioItemFilters(input)).toEqual({
        other_key: 'keep-me',
        created_on: { from: '2025-01-01', to: '2025-12-31' },
      });
    });

    it('should allow explicit overrides to take precedence', () => {
      const input = {
        created_on: { from: '2024-01-01' },
      };
      expect(buildPodioItemFilters(input, { createdFrom: '2025-01-01' })).toEqual({
        created_on: { from: '2025-01-01' },
      });
    });

    it('should throw on invalid filters', () => {
      expect(() => buildPodioItemFilters({ createdFrom: 'not-a-date' })).toThrow(/Invalid filters/);
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

      it('should return valid for correct date format', () => {
        const filters = {
          createdFrom: '2025-01-01',
          createdTo: '2025-12-31',
        };
        const result = validateFilters(filters);
        expect(result.valid).toBe(true);
        expect(result.errors).toEqual([]);
      });

      it('should return valid for correct datetime format', () => {
        const filters = {
          createdFrom: '2025-01-01 00:00:00',
          lastEditTo: '2025-12-31 23:59:59',
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
        expect(result.errors[0]).toContain('must be before');
      });

      it('should reject lastEditFrom after lastEditTo', () => {
        const filters = {
          lastEditFrom: '2025-06-30',
          lastEditTo: '2025-06-01',
        };
        const result = validateFilters(filters);
        expect(result.valid).toBe(false);
        expect(result.errors[0]).toContain('must be before');
      });

      it('should allow same date for from and to', () => {
        const filters = {
          createdFrom: '2025-06-15',
          createdTo: '2025-06-15',
        };
        const result = validateFilters(filters);
        expect(result.valid).toBe(true);
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
    });
  });
});
