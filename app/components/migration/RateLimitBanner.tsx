'use client';

import React, { useEffect, useState } from 'react';
import { useMigrationContext } from '@/app/contexts/MigrationContext';

function formatTimeRemaining(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m`;
  } else if (minutes > 0) {
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  } else {
    return `${seconds}s`;
  }
}

/**
 * Banner showing API rate limit status
 *
 * Features:
 * - Shows when API rate limited with countdown
 * - Shows API quota usage when low
 * - Auto-hides when quota is healthy
 * - Live countdown timer
 */
export function RateLimitBanner() {
  const { rateLimitInfo } = useMigrationContext();
  const [currentTime, setCurrentTime] = useState(Date.now());

  // Update current time every second for countdown
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(Date.now());
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  // Don't show banner if no rate limit info
  if (!rateLimitInfo) {
    return null;
  }

  const { limit, remaining, resetAt, isLimited } = rateLimitInfo;

  // Calculate time until reset
  const resetTime = new Date(resetAt).getTime();
  const timeUntilReset = Math.max(0, resetTime - currentTime);

  // Calculate usage percentage
  const percentUsed = Math.round(((limit - remaining) / limit) * 100);
  const percentRemaining = 100 - percentUsed;

  // Determine severity and whether to show
  let severity: 'error' | 'warning' | 'info' = 'info';
  let shouldShow = false;

  if (isLimited) {
    severity = 'error';
    shouldShow = true;
  } else if (remaining < 50) {
    severity = 'warning';
    shouldShow = true;
  } else if (remaining < 100) {
    severity = 'info';
    shouldShow = true;
  }

  if (!shouldShow) {
    return null;
  }

  const bgColor = {
    error: 'bg-red-50 border-red-200',
    warning: 'bg-yellow-50 border-yellow-200',
    info: 'bg-blue-50 border-blue-200'
  }[severity];

  const textColor = {
    error: 'text-red-800',
    warning: 'text-yellow-800',
    info: 'text-blue-800'
  }[severity];

  const iconColor = {
    error: 'text-red-500',
    warning: 'text-yellow-500',
    info: 'text-blue-500'
  }[severity];

  return (
    <div className={`border rounded-lg p-4 mb-4 ${bgColor}`}>
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 ${iconColor}`}>
          {isLimited ? (
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
            </svg>
          ) : (
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
          )}
        </div>

        <div className="flex-1">
          <div className={`font-medium ${textColor}`}>
            {isLimited ? (
              <>API Rate Limit Reached</>
            ) : (
              <>API Quota Running Low</>
            )}
          </div>

          <div className={`mt-1 text-sm ${textColor}`}>
            {isLimited ? (
              <div>
                <p>
                  All API requests ({limit} per hour) have been used.
                  Migrations will automatically resume when the quota resets.
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <div className="font-medium">Resets in:</div>
                  <div className="font-mono font-bold">
                    {formatTimeRemaining(timeUntilReset)}
                  </div>
                </div>
              </div>
            ) : (
              <div>
                <p>
                  Only {remaining} of {limit} API requests remaining ({percentRemaining}% quota available).
                  {remaining < 20 && ' Migrations may pause soon to avoid hitting the rate limit.'}
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <div className="font-medium">Quota resets in:</div>
                  <div className="font-mono">
                    {formatTimeRemaining(timeUntilReset)}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Progress bar */}
          <div className="mt-3 w-full bg-white rounded-full h-2 overflow-hidden">
            <div
              className={`h-full transition-all duration-300 ${
                isLimited
                  ? 'bg-red-500'
                  : remaining < 50
                  ? 'bg-yellow-500'
                  : 'bg-blue-500'
              }`}
              style={{ width: `${percentUsed}%` }}
            />
          </div>
          <div className={`mt-1 text-xs ${textColor} opacity-75 text-right`}>
            {remaining}/{limit} requests remaining
          </div>
        </div>
      </div>
    </div>
  );
}
