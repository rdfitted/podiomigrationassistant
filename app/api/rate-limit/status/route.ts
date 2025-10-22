import { NextResponse } from 'next/server';
import { getRateLimitTracker } from '@/lib/podio/http/rate-limit-tracker';

/**
 * GET /api/rate-limit/status
 * Returns current rate limit status
 */
export async function GET() {
  try {
    const tracker = getRateLimitTracker();
    const state = tracker.getState();

    if (!state) {
      return NextResponse.json({
        hasData: false,
        limit: null,
        remaining: null,
        resetAt: null,
        isLimited: false,
        timeUntilReset: null,
        percentUsed: null
      }, {
        status: 200,
        headers: { 'Cache-Control': 'no-store' }
      });
    }

    // Defensive: Ensure all values are safe to serialize
    const safeLimit = typeof state.limit === 'number' && isFinite(state.limit) ? state.limit : 0;
    const safeRemaining = typeof state.remaining === 'number' && isFinite(state.remaining) ? state.remaining : 0;

    const timeUntilReset = Math.max(0, tracker.getTimeUntilReset());
    const percentUsedRaw =
      safeLimit > 0
        ? ((safeLimit - safeRemaining) / safeLimit) * 100
        : 0;
    const percentUsed = Math.max(0, Math.min(100, Math.round(percentUsedRaw)));
    const isLimited = tracker.shouldPause(10);

    // Defensive: Safely serialize lastUpdated
    let lastUpdatedStr: string;
    try {
      lastUpdatedStr = state.lastUpdated instanceof Date
        ? state.lastUpdated.toISOString()
        : new Date().toISOString();
    } catch (err) {
      console.warn('Failed to serialize lastUpdated, using current time:', err);
      lastUpdatedStr = new Date().toISOString();
    }

    return NextResponse.json({
      hasData: true,
      limit: safeLimit,
      remaining: safeRemaining,
      resetAt: state.reset,
      isLimited,
      timeUntilReset,
      percentUsed,
      lastUpdated: lastUpdatedStr
    }, {
      headers: { 'Cache-Control': 'no-store' }
    });
  } catch (error) {
    console.error('Error in rate-limit status API:', error);
    // Return a valid response even if there's an error
    // This prevents client-side polling from breaking
    return NextResponse.json({
      hasData: false,
      limit: null,
      remaining: null,
      resetAt: null,
      isLimited: false,
      timeUntilReset: null,
      percentUsed: null
    }, {
      status: 200,
      headers: { 'Cache-Control': 'no-store' }
    }); // Use 200 to prevent client retries
  }
}
