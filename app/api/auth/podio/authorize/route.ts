/**
 * Podio OAuth Authorization Redirect
 * Redirects user to Podio to authorize the app
 */

import { NextRequest } from 'next/server';
import { loadPodioConfig } from '@/lib/podio/config';
import { getAuthorizationUrl } from '@/lib/podio/auth/authorization-flow';
import { randomBytes } from 'crypto';

export async function GET(req: NextRequest) {
  try {
    const config = loadPodioConfig();

    // Generate random state for CSRF protection
    const state = randomBytes(32).toString('hex');

    // Use PODIO_REDIRECT_URI if set (for localtunnel), otherwise use request origin
    const redirectUri = process.env.PODIO_REDIRECT_URI || `${req.nextUrl.origin}/api/auth/podio/callback`;

    // Store state in cookie for validation on callback
    const response = new Response(null, {
      status: 302,
      headers: {
        'Set-Cookie': `podio_oauth_state=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600`,
        'Location': getAuthorizationUrl(
          config,
          redirectUri,
          state
        ),
      },
    });

    return response;
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Failed to initiate authorization',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}
