/**
 * Rate limit quota tracker for Podio API
 * Tracks remaining requests and provides intelligent pause/resume logic
 *
 * Features:
 * - Tracks quota from X-Rate-Limit headers
 * - Detects when approaching limit
 * - Calculates time until quota reset
 * - Provides auto-pause/resume functionality
 */

import { podioLog } from '../logging';

/**
 * Rate limit state
 */
export interface RateLimitState {
  /** Current rate limit (requests per hour) */
  limit: number;
  /** Remaining requests in current window */
  remaining: number;
  /** Timestamp when quota resets (ISO 8601 string) */
  reset: string;
  /** Last updated timestamp */
  lastUpdated: Date;
}

/**
 * Rate limit tracker singleton
 * Monitors API quota and provides pause/resume logic
 */
export class RateLimitTracker {
  private state: RateLimitState | null = null;
  private listeners: Set<(state: RateLimitState) => void> = new Set();

  /**
   * Update rate limit state from response headers
   *
   * @param limit - Value from X-Rate-Limit-Limit header
   * @param remaining - Value from X-Rate-Limit-Remaining header
   * @param reset - Value from X-Rate-Limit-Reset header (ISO 8601 timestamp)
   */
  updateFromHeaders(limit: number, remaining: number, reset: string): void {
    // Defensive: Validate inputs before updating state
    if (typeof limit !== 'number' || !isFinite(limit) || limit < 0) {
      podioLog('warn', 'Invalid rate limit value received, skipping update', { limit });
      return;
    }

    if (typeof remaining !== 'number' || !isFinite(remaining) || remaining < 0) {
      podioLog('warn', 'Invalid remaining value received, skipping update', { remaining });
      return;
    }

    if (typeof reset !== 'string' || !reset) {
      podioLog('warn', 'Invalid reset timestamp received, skipping update', { reset });
      return;
    }

    // Validate reset timestamp is parseable
    const resetDate = new Date(reset);
    if (isNaN(resetDate.getTime())) {
      podioLog('warn', 'Invalid reset timestamp format, skipping update', { reset });
      return;
    }

    const previousRemaining = this.state?.remaining ?? limit;

    this.state = {
      limit,
      remaining,
      reset,
      lastUpdated: new Date(),
    };

    // Log significant changes
    if (remaining < previousRemaining) {
      podioLog('debug', 'Rate limit quota updated', {
        limit,
        remaining,
        consumed: limit - remaining,
        percentUsed: Math.round(((limit - remaining) / limit) * 100),
        reset,
      });
    }

    // Warning if approaching limit
    if (remaining < 20 && remaining > 0) {
      podioLog('warn', 'Approaching rate limit', {
        remaining,
        limit,
        percentRemaining: Math.round((remaining / limit) * 100),
      });
    }

    // Notify listeners
    this.notifyListeners();
  }

  /**
   * Get current remaining quota
   * @returns Number of requests remaining, or null if unknown
   */
  getRemainingQuota(): number | null {
    return this.state?.remaining ?? null;
  }

  /**
   * Get current rate limit
   * @returns Rate limit (requests per hour), or null if unknown
   */
  getLimit(): number | null {
    return this.state?.limit ?? null;
  }

  /**
   * Get current rate limit state
   */
  getState(): RateLimitState | null {
    return this.state;
  }

  /**
   * Check if should pause before making next request
   *
   * @param threshold - Pause when remaining < this value (default: 10)
   * @returns True if should pause
   */
  shouldPause(threshold: number = 10): boolean {
    if (!this.state) {
      return false; // No state yet, don't pause
    }

    return this.state.remaining < threshold;
  }

  /**
   * Get milliseconds until rate limit resets
   *
   * @returns Milliseconds until reset, or 0 if reset time has passed
   */
  getTimeUntilReset(): number {
    if (!this.state) {
      return 0;
    }

    try {
      const resetTime = new Date(this.state.reset).getTime();

      // Defensive: Check if resetTime is valid
      if (!isFinite(resetTime) || isNaN(resetTime)) {
        podioLog('warn', 'Invalid reset time, returning 0', { reset: this.state.reset });
        return 0;
      }

      const now = Date.now();
      const timeUntilReset = resetTime - now;

      return Math.max(0, timeUntilReset);
    } catch (error) {
      podioLog('error', 'Error calculating time until reset', {
        error: error instanceof Error ? error.message : String(error),
        reset: this.state.reset,
      });
      return 0;
    }
  }

  /**
   * Wait until rate limit resets
   * Returns a promise that resolves after the reset time
   *
   * @param maxWait - Maximum time to wait in ms (default: 3600000 = 1 hour)
   * @returns Promise that resolves when quota should be reset
   */
  async waitForReset(maxWait: number = 3600000): Promise<void> {
    const timeUntilReset = this.getTimeUntilReset();

    if (timeUntilReset === 0) {
      podioLog('info', 'Rate limit already reset, continuing');
      return;
    }

    const waitTime = Math.min(timeUntilReset, maxWait);
    const resumeAt = new Date(Date.now() + waitTime);

    podioLog('info', 'Waiting for rate limit reset', {
      waitTimeMs: waitTime,
      waitTimeSeconds: Math.round(waitTime / 1000),
      waitTimeMinutes: Math.round(waitTime / 60000),
      resumeAt: resumeAt.toISOString(),
      currentRemaining: this.state?.remaining ?? 0,
    });

    return new Promise((resolve) => {
      setTimeout(() => {
        podioLog('info', 'Rate limit wait complete, resuming');
        resolve();
      }, waitTime);
    });
  }

  /**
   * Register a listener for rate limit state changes
   *
   * @param listener - Callback function called when state changes
   * @returns Unsubscribe function
   */
  onStateChange(listener: (state: RateLimitState) => void): () => void {
    this.listeners.add(listener);

    // Return unsubscribe function
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Notify all listeners of state change
   */
  private notifyListeners(): void {
    if (this.state) {
      this.listeners.forEach(listener => {
        try {
          listener(this.state!);
        } catch (error) {
          podioLog('error', 'Error in rate limit listener', {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });
    }
  }

  /**
   * Reset tracker state (for testing)
   */
  reset(): void {
    this.state = null;
    this.listeners.clear();
    podioLog('debug', 'Rate limit tracker reset');
  }

  /**
   * Check if we have rate limit information
   */
  hasState(): boolean {
    return this.state !== null;
  }

  /**
   * Get formatted status string for logging
   */
  getStatus(): string {
    if (!this.state) {
      return 'No rate limit data';
    }

    const percentUsed = Math.round(((this.state.limit - this.state.remaining) / this.state.limit) * 100);
    const timeUntilReset = this.getTimeUntilReset();
    const minutesUntilReset = Math.round(timeUntilReset / 60000);

    return `${this.state.remaining}/${this.state.limit} requests remaining (${percentUsed}% used), resets in ${minutesUntilReset}min`;
  }
}

/**
 * Singleton instance
 */
let trackerInstance: RateLimitTracker | null = null;

/**
 * Get the singleton RateLimitTracker instance
 */
export function getRateLimitTracker(): RateLimitTracker {
  if (!trackerInstance) {
    trackerInstance = new RateLimitTracker();
  }
  return trackerInstance;
}

/**
 * Reset the singleton instance (for testing)
 */
export function resetRateLimitTracker(): void {
  if (trackerInstance) {
    trackerInstance.reset();
  }
  trackerInstance = null;
}
