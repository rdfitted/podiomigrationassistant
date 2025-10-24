/**
 * Tests for batch processor rate limit handling
 * Verifies that the batch processor properly detects and pauses on rate limit errors
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { ItemBatchProcessor } from '../../../lib/migration/items/batch-processor';
import { PodioHttpClient } from '../../../lib/podio/http/client';
import { getRateLimitTracker, resetRateLimitTracker } from '../../../lib/podio/http/rate-limit-tracker';
import * as itemsModule from '../../../lib/podio/resources/items';

// Mock the items module
jest.mock('../../../lib/podio/resources/items');

describe('ItemBatchProcessor Rate Limit Handling', () => {
  let mockClient: jest.Mocked<PodioHttpClient>;
  let processor: ItemBatchProcessor;
  const testAppId = 12345;

  beforeEach(() => {
    // Reset rate limit tracker before each test
    resetRateLimitTracker();

    // Create mock client
    mockClient = {
      get: jest.fn(),
      post: jest.fn(),
      put: jest.fn(),
      delete: jest.fn(),
    } as unknown as jest.Mocked<PodioHttpClient>;

    // Create processor with small batch size for testing
    processor = new ItemBatchProcessor(
      mockClient,
      testAppId,
      {
        batchSize: 2, // Small batch size to test multiple batches
        concurrency: 2,
        maxRetries: 3,
        stopOnError: false,
      }
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
    resetRateLimitTracker();
  });

  describe('processUpdate with rate limit errors', () => {
    it('should pause before next batch when rate limit errors are detected', async () => {
      const updates = [
        { itemId: 1, fields: { title: 'Item 1' } },
        { itemId: 2, fields: { title: 'Item 2' } },
        { itemId: 3, fields: { title: 'Item 3' } },
        { itemId: 4, fields: { title: 'Item 4' } },
      ];

      // Mock bulkUpdateItems to return rate limit error in first batch
      const mockBulkUpdateItems = itemsModule.bulkUpdateItems as jest.MockedFunction<typeof itemsModule.bulkUpdateItems>;

      // First batch: one success, one rate limit failure
      // Second batch: all successful (after pause)
      mockBulkUpdateItems
        .mockResolvedValueOnce({
          successful: [{ itemId: 1, revision: 1 }],
          failed: [
            {
              itemId: 2,
              fields: { title: 'Item 2' },
              error: 'Rate limit exceeded (429)',
              index: 1,
            },
          ],
          successCount: 1,
          failureCount: 1,
        })
        .mockResolvedValueOnce({
          successful: [
            { itemId: 3, revision: 1 },
            { itemId: 4, revision: 1 },
          ],
          failed: [],
          successCount: 2,
          failureCount: 0,
        });

      // Set up rate limit tracker state
      const tracker = getRateLimitTracker();
      const resetTime = new Date(Date.now() + 5000).toISOString(); // 5 seconds from now
      tracker.updateFromHeaders(100, 5, resetTime);

      // Spy on waitForReset to verify it's called
      const waitForResetSpy = jest.spyOn(tracker, 'waitForReset').mockResolvedValue();

      // Track events
      const rateLimitPauseEvents: Array<{ reason?: string }> = [];
      processor.on('rateLimitPause', (event) => {
        rateLimitPauseEvents.push(event);
      });

      // Execute
      const result = await processor.processUpdate(updates);

      // Verify results
      expect(result.successful).toBe(3);
      expect(result.failed).toBe(1);

      // Verify waitForReset was called
      expect(waitForResetSpy).toHaveBeenCalledTimes(1);

      // Verify rateLimitPause event was emitted
      expect(rateLimitPauseEvents).toHaveLength(1);
      expect(rateLimitPauseEvents[0].reason).toBe('batch_failures');
    });

    it('should not pause if no rate limit errors occurred', async () => {
      const updates = [
        { itemId: 1, fields: { title: 'Item 1' } },
        { itemId: 2, fields: { title: 'Item 2' } },
        { itemId: 3, fields: { title: 'Item 3' } },
      ];

      // Mock bulkUpdateItems to return all successful
      const mockBulkUpdateItems = itemsModule.bulkUpdateItems as jest.MockedFunction<typeof itemsModule.bulkUpdateItems>;

      mockBulkUpdateItems
        .mockResolvedValueOnce({
          successful: [
            { itemId: 1, revision: 1 },
            { itemId: 2, revision: 1 },
          ],
          failed: [],
          successCount: 2,
          failureCount: 0,
        })
        .mockResolvedValueOnce({
          successful: [{ itemId: 3, revision: 1 }],
          failed: [],
          successCount: 1,
          failureCount: 0,
        });

      // Set up rate limit tracker
      const tracker = getRateLimitTracker();
      const resetTime = new Date(Date.now() + 5000).toISOString();
      tracker.updateFromHeaders(100, 50, resetTime);

      // Spy on waitForReset to verify it's NOT called
      const waitForResetSpy = jest.spyOn(tracker, 'waitForReset');

      // Execute
      const result = await processor.processUpdate(updates);

      // Verify results
      expect(result.successful).toBe(3);
      expect(result.failed).toBe(0);

      // Verify waitForReset was NOT called (no rate limit errors)
      expect(waitForResetSpy).not.toHaveBeenCalled();
    });

    it('should pause proactively when remaining quota is low', async () => {
      const updates = [
        { itemId: 1, fields: { title: 'Item 1' } },
        { itemId: 2, fields: { title: 'Item 2' } },
      ];

      const mockBulkUpdateItems = itemsModule.bulkUpdateItems as jest.MockedFunction<typeof itemsModule.bulkUpdateItems>;

      mockBulkUpdateItems.mockResolvedValueOnce({
        successful: [
          { itemId: 1, revision: 1 },
          { itemId: 2, revision: 1 },
        ],
        failed: [],
        successCount: 2,
        failureCount: 0,
      });

      const tracker = getRateLimitTracker();
      const resetTime = new Date(Date.now() + 2000).toISOString();
      tracker.updateFromHeaders(100, 5, resetTime);

      const waitForResetSpy = jest.spyOn(tracker, 'waitForReset').mockResolvedValue();
      const pauseEvents: Array<{ reason?: string; resumeAt: Date }> = [];
      const resumeSpy = jest.fn();
      processor.on('rateLimitPause', event => pauseEvents.push(event));
      processor.on('rateLimitResume', resumeSpy);

      const result = await processor.processUpdate(updates);

      expect(result.successful).toBe(2);
      expect(result.failed).toBe(0);
      expect(waitForResetSpy).toHaveBeenCalledTimes(1);
      expect(pauseEvents).toHaveLength(1);
      expect(pauseEvents[0].reason).toBe('pre_batch_quota');
      expect(pauseEvents[0].resumeAt).toBeInstanceOf(Date);
      expect(resumeSpy).toHaveBeenCalledTimes(1);
    });

    it('should detect rate limit errors with 420 status code', async () => {
      const updates = [
        { itemId: 1, fields: { title: 'Item 1' } },
        { itemId: 2, fields: { title: 'Item 2' } },
      ];

      // Mock bulkUpdateItems to return 420 error
      const mockBulkUpdateItems = itemsModule.bulkUpdateItems as jest.MockedFunction<typeof itemsModule.bulkUpdateItems>;

      mockBulkUpdateItems.mockResolvedValueOnce({
        successful: [],
        failed: [
          {
            itemId: 1,
            fields: { title: 'Item 1' },
            error: 'API rate limited (420)',
            index: 0,
          },
          {
            itemId: 2,
            fields: { title: 'Item 2' },
            error: 'API rate limited (420)',
            index: 1,
          },
        ],
        successCount: 0,
        failureCount: 2,
      });

      // Set up rate limit tracker
      const tracker = getRateLimitTracker();
      const resetTime = new Date(Date.now() + 3600000).toISOString(); // 1 hour
      tracker.updateFromHeaders(100, 0, resetTime);

      // Spy on waitForReset
      const waitForResetSpy = jest.spyOn(tracker, 'waitForReset').mockResolvedValue();

      // Execute
      await processor.processUpdate(updates);

      // Verify waitForReset was called for 420 errors
      expect(waitForResetSpy).toHaveBeenCalled();
    });

    it('should not pause on last batch even if rate limit errors occurred', async () => {
      const updates = [
        { itemId: 1, fields: { title: 'Item 1' } },
        { itemId: 2, fields: { title: 'Item 2' } },
      ];

      // Mock bulkUpdateItems to return rate limit error in last batch
      const mockBulkUpdateItems = itemsModule.bulkUpdateItems as jest.MockedFunction<typeof itemsModule.bulkUpdateItems>;

      mockBulkUpdateItems.mockResolvedValueOnce({
        successful: [],
        failed: [
          {
            itemId: 1,
            fields: { title: 'Item 1' },
            error: 'Rate limit exceeded (429)',
            index: 0,
          },
          {
            itemId: 2,
            fields: { title: 'Item 2' },
            error: 'Rate limit exceeded (429)',
            index: 1,
          },
        ],
        successCount: 0,
        failureCount: 2,
      });

      // Set up rate limit tracker
      const tracker = getRateLimitTracker();
      const resetTime = new Date(Date.now() + 5000).toISOString();
      tracker.updateFromHeaders(100, 5, resetTime);

      // Spy on waitForReset to verify it's NOT called (last batch)
      const waitForResetSpy = jest.spyOn(tracker, 'waitForReset');

      // Execute
      const result = await processor.processUpdate(updates);

      // Verify results
      expect(result.failed).toBe(2);

      // Verify waitForReset was NOT called (last batch doesn't trigger pause)
      expect(waitForResetSpy).not.toHaveBeenCalled();
    });

    it('should not pause if tracker has no reset time', async () => {
      const updates = [
        { itemId: 1, fields: { title: 'Item 1' } },
        { itemId: 2, fields: { title: 'Item 2' } },
        { itemId: 3, fields: { title: 'Item 3' } },
      ];

      // Mock bulkUpdateItems to return rate limit error
      const mockBulkUpdateItems = itemsModule.bulkUpdateItems as jest.MockedFunction<typeof itemsModule.bulkUpdateItems>;

      mockBulkUpdateItems
        .mockResolvedValueOnce({
          successful: [],
          failed: [
            {
              itemId: 1,
              fields: { title: 'Item 1' },
              error: 'Rate limit exceeded (429)',
              index: 0,
            },
            {
              itemId: 2,
              fields: { title: 'Item 2' },
              error: 'Rate limit exceeded (429)',
              index: 1,
            },
          ],
          successCount: 0,
          failureCount: 2,
        })
        .mockResolvedValueOnce({
          successful: [{ itemId: 3, revision: 1 }],
          failed: [],
          successCount: 1,
          failureCount: 0,
        });

      // Tracker has no state (reset time is 0 or already passed)
      const tracker = getRateLimitTracker();
      const waitForResetSpy = jest.spyOn(tracker, 'waitForReset');

      // Execute
      const result = await processor.processUpdate(updates);

      // Verify results
      expect(result.successful).toBe(1);
      expect(result.failed).toBe(2);

      // Verify waitForReset was NOT called (no reset time available)
      expect(waitForResetSpy).not.toHaveBeenCalled();
    });
  });

  describe('processCreate with rate limit errors', () => {
    it('should pause before next batch when rate limit errors are detected', async () => {
      const items = [
        { fields: { title: 'Item 1' } },
        { fields: { title: 'Item 2' } },
        { fields: { title: 'Item 3' } },
        { fields: { title: 'Item 4' } },
      ];

      // Mock bulkCreateItems
      const mockBulkCreateItems = itemsModule.bulkCreateItems as jest.MockedFunction<typeof itemsModule.bulkCreateItems>;

      mockBulkCreateItems
        .mockResolvedValueOnce({
          successful: [
            { item_id: 1001, app_item_id: 1, title: 'Item 1', link: '', revision: 1 },
          ],
          failed: [
            {
              request: { fields: { title: 'Item 2' } },
              error: 'Rate limit exceeded (429)',
              index: 1,
            },
          ],
          successCount: 1,
          failureCount: 1,
        })
        .mockResolvedValueOnce({
          successful: [
            { item_id: 1003, app_item_id: 3, title: 'Item 3', link: '', revision: 1 },
            { item_id: 1004, app_item_id: 4, title: 'Item 4', link: '', revision: 1 },
          ],
          failed: [],
          successCount: 2,
          failureCount: 0,
        });

      // Set up rate limit tracker
      const tracker = getRateLimitTracker();
      const resetTime = new Date(Date.now() + 5000).toISOString();
      tracker.updateFromHeaders(100, 5, resetTime);

      // Spy on waitForReset
      const waitForResetSpy = jest.spyOn(tracker, 'waitForReset').mockResolvedValue();
      const pauseEvents: Array<{ reason?: string; resumeAt: Date }> = [];
      const resumeSpy = jest.fn();
      processor.on('rateLimitPause', (event) => {
        pauseEvents.push(event);
      });
      processor.on('rateLimitResume', resumeSpy);

      // Execute
      const result = await processor.processCreate(items);

      // Verify results
      expect(result.successful).toBe(3);
      expect(result.failed).toBe(1);

      // Verify waitForReset was called
      expect(waitForResetSpy).toHaveBeenCalledTimes(1);
      expect(pauseEvents).toHaveLength(1);
      expect(pauseEvents[0].reason).toBe('batch_failures');
      expect(pauseEvents[0].resumeAt).toBeInstanceOf(Date);
      expect(resumeSpy).toHaveBeenCalledTimes(1);
    });
  });
});
