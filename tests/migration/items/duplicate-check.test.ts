/**
 * Tests for duplicate check utilities
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { normalizeMatchValue, buildDuplicateKey, DuplicateChecker } from '../../../lib/migration/items/duplicate-check';
import { PodioItem } from '../../../lib/podio/resources/items';

describe('normalizeMatchValue', () => {
  describe('text fields', () => {
    it('should trim whitespace and convert to lowercase', () => {
      expect(normalizeMatchValue('  Hello World  ', 'text')).toBe('hello world');
      expect(normalizeMatchValue('UPPERCASE', 'text')).toBe('uppercase');
      expect(normalizeMatchValue('  Mixed Case  ', 'text')).toBe('mixed case');
    });

    it('should handle empty strings', () => {
      expect(normalizeMatchValue('', 'text')).toBe('');
      expect(normalizeMatchValue('   ', 'text')).toBe('');
    });
  });

  describe('number fields', () => {
    it('should normalize numbers to string', () => {
      expect(normalizeMatchValue(123, 'number')).toBe('123');
      expect(normalizeMatchValue('456', 'number')).toBe('456');
      expect(normalizeMatchValue(0, 'number')).toBe('0');
    });

    it('should handle decimal numbers', () => {
      expect(normalizeMatchValue(123.45, 'number')).toBe('123.45');
      expect(normalizeMatchValue('678.90', 'number')).toBe('678.9');
    });

    it('should handle invalid numbers', () => {
      expect(normalizeMatchValue('not a number', 'number')).toBe('');
      expect(normalizeMatchValue(NaN, 'number')).toBe('');
    });
  });

  describe('category fields', () => {
    it('should sort array values', () => {
      expect(normalizeMatchValue([3, 1, 2], 'category')).toBe('1,2,3');
      expect(normalizeMatchValue(['c', 'a', 'b'], 'category')).toBe('a,b,c');
    });

    it('should handle single values', () => {
      expect(normalizeMatchValue(5, 'category')).toBe('5');
      expect(normalizeMatchValue('single', 'category')).toBe('single');
    });

    it('should handle empty arrays', () => {
      expect(normalizeMatchValue([], 'category')).toBe('');
    });
  });

  describe('email fields', () => {
    it('should normalize email objects', () => {
      expect(normalizeMatchValue([{ type: 'work', value: 'TEST@EXAMPLE.COM' }], 'email')).toBe('test@example.com');
      expect(normalizeMatchValue([{ type: 'home', value: '  user@domain.com  ' }], 'email')).toBe('user@domain.com');
    });

    it('should sort multiple emails', () => {
      const emails = [
        { type: 'work', value: 'work@example.com' },
        { type: 'home', value: 'home@example.com' },
      ];
      expect(normalizeMatchValue(emails, 'email')).toBe('home@example.com,work@example.com');
    });
  });

  describe('phone fields', () => {
    it('should normalize phone objects', () => {
      expect(normalizeMatchValue([{ type: 'mobile', value: '  555-1234  ' }], 'phone')).toBe('555-1234');
      expect(normalizeMatchValue([{ type: 'work', value: 'OFFICE' }], 'phone')).toBe('office');
    });
  });

  describe('date fields', () => {
    it('should extract start date', () => {
      expect(normalizeMatchValue({ start: '2025-01-01', end: '2025-01-31' }, 'date')).toBe('2025-01-01');
      expect(normalizeMatchValue({ start: '2025-12-25' }, 'date')).toBe('2025-12-25');
    });

    it('should handle missing dates', () => {
      expect(normalizeMatchValue({}, 'date')).toBe('');
      expect(normalizeMatchValue({ end: '2025-01-31' }, 'date')).toBe('');
    });
  });

  describe('money fields', () => {
    it('should normalize money objects', () => {
      expect(normalizeMatchValue({ value: 100, currency: 'USD' }, 'money')).toBe('100');
      expect(normalizeMatchValue({ value: '250.50' }, 'money')).toBe('250.50');
    });
  });

  describe('null/undefined values', () => {
    it('should return empty string for null/undefined', () => {
      expect(normalizeMatchValue(null, 'text')).toBe('');
      expect(normalizeMatchValue(undefined, 'text')).toBe('');
      expect(normalizeMatchValue(null, 'number')).toBe('');
    });
  });
});

describe('buildDuplicateKey', () => {
  it('should create consistent cache keys', () => {
    const key1 = buildDuplicateKey(12345, 'title', 'normalized value');
    const key2 = buildDuplicateKey(12345, 'title', 'normalized value');
    expect(key1).toBe(key2);
  });

  it('should create unique keys for different values', () => {
    const key1 = buildDuplicateKey(12345, 'title', 'value1');
    const key2 = buildDuplicateKey(12345, 'title', 'value2');
    expect(key1).not.toBe(key2);
  });

  it('should create unique keys for different fields', () => {
    const key1 = buildDuplicateKey(12345, 'title', 'value');
    const key2 = buildDuplicateKey(12345, 'description', 'value');
    expect(key1).not.toBe(key2);
  });

  it('should create unique keys for different apps', () => {
    const key1 = buildDuplicateKey(12345, 'title', 'value');
    const key2 = buildDuplicateKey(67890, 'title', 'value');
    expect(key1).not.toBe(key2);
  });
});

describe('DuplicateChecker', () => {
  let checker: DuplicateChecker;

  beforeEach(() => {
    checker = new DuplicateChecker();
  });

  describe('checkDuplicate', () => {
    it('should return no duplicate when item not found', async () => {
      const lookupFn = async () => null;
      const result = await checker.checkDuplicate(lookupFn, 12345, 'title', 'test value', 'text');

      expect(result.isDuplicate).toBe(false);
      expect(result.existingItem).toBeUndefined();
      expect(result.normalizedKey).toBe('test value');
      expect(result.fromCache).toBe(false);
    });

    it('should return duplicate when item found', async () => {
      const mockItem: PodioItem = {
        item_id: 999,
        app_item_id: 1,
        app: { app_id: 12345, config: { name: 'Test App' } },
        fields: [],
        created_on: '2025-01-01',
        created_by: { user_id: 1, name: 'Test User' },
        link: 'https://podio.com/test',
        rights: [],
      };

      const lookupFn = async () => mockItem;
      const result = await checker.checkDuplicate(lookupFn, 12345, 'title', 'test value', 'text');

      expect(result.isDuplicate).toBe(true);
      expect(result.existingItem).toBe(mockItem);
      expect(result.normalizedKey).toBe('test value');
      expect(result.fromCache).toBe(false);
    });

    it('should use cache on subsequent lookups', async () => {
      let callCount = 0;
      const mockItem: PodioItem = {
        item_id: 999,
        app_item_id: 1,
        app: { app_id: 12345, config: { name: 'Test App' } },
        fields: [],
        created_on: '2025-01-01',
        created_by: { user_id: 1, name: 'Test User' },
        link: 'https://podio.com/test',
        rights: [],
      };

      const lookupFn = async () => {
        callCount++;
        return mockItem;
      };

      // First lookup
      const result1 = await checker.checkDuplicate(lookupFn, 12345, 'title', 'test value', 'text');
      expect(result1.fromCache).toBe(false);
      expect(callCount).toBe(1);

      // Second lookup - should use cache
      const result2 = await checker.checkDuplicate(lookupFn, 12345, 'title', 'test value', 'text');
      expect(result2.fromCache).toBe(true);
      expect(callCount).toBe(1); // No additional lookup
    });

    it('should normalize values before caching', async () => {
      let callCount = 0;
      const lookupFn = async () => {
        callCount++;
        return null;
      };

      // Different casing and whitespace - should use same cache entry
      await checker.checkDuplicate(lookupFn, 12345, 'title', '  Test Value  ', 'text');
      await checker.checkDuplicate(lookupFn, 12345, 'title', 'TEST VALUE', 'text');

      expect(callCount).toBe(1); // Only one lookup needed
    });
  });

  describe('cache management', () => {
    it('should track cache hits and misses', async () => {
      const lookupFn = async () => null;

      await checker.checkDuplicate(lookupFn, 12345, 'title', 'value1', 'text');
      await checker.checkDuplicate(lookupFn, 12345, 'title', 'value1', 'text'); // cache hit
      await checker.checkDuplicate(lookupFn, 12345, 'title', 'value2', 'text');

      const stats = checker.getCacheStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(2);
      expect(stats.size).toBe(2);
      expect(stats.hitRate).toBe(0.33); // 1/3 rounded
    });

    it('should clear cache', async () => {
      const lookupFn = async () => null;

      await checker.checkDuplicate(lookupFn, 12345, 'title', 'value1', 'text');
      await checker.checkDuplicate(lookupFn, 12345, 'title', 'value2', 'text');

      checker.clearCache();

      const stats = checker.getCacheStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(stats.size).toBe(0);
    });
  });
});
