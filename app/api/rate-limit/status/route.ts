import { NextResponse } from 'next/server';
import { getRateLimitTracker } from '@/lib/podio/http/rate-limit-tracker';

/**
 * GET /api/rate-limit/status
 * Returns current rate limit status
 */
export async function GET() {
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
    });
  }

  const timeUntilReset = tracker.getTimeUntilReset();
  const percentUsed = Math.round(((state.limit - state.remaining) / state.limit) * 100);
  const isLimited = tracker.shouldPause(10);

  return NextResponse.json({
    hasData: true,
    limit: state.limit,
    remaining: state.remaining,
    resetAt: state.reset,
    isLimited,
    timeUntilReset,
    percentUsed,
    lastUpdated: state.lastUpdated.toISOString()
  });
}
