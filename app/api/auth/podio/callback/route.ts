/**
 * Podio OAuth Callback Handler
 * Receives authorization code from Podio and exchanges it for tokens
 */

import { NextRequest } from 'next/server';
import { loadPodioConfig } from '@/lib/podio/config';
import { exchangeCodeForToken } from '@/lib/podio/auth/authorization-flow';
import { saveTokens } from '@/lib/podio/auth/token-store';
import { cookies } from 'next/headers';

export async function GET(req: NextRequest) {
  try {
    const searchParams = req.nextUrl.searchParams;
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const error = searchParams.get('error');

    // Check for authorization errors
    if (error) {
      return new Response(
        `<!DOCTYPE html>
        <html>
          <head><title>Authorization Failed</title></head>
          <body>
            <h1>Authorization Failed</h1>
            <p>Error: ${error}</p>
            <p>Description: ${searchParams.get('error_description') || 'No description provided'}</p>
            <p><a href="/">Return to home</a></p>
          </body>
        </html>`,
        {
          status: 400,
          headers: { 'Content-Type': 'text/html' },
        }
      );
    }

    // Validate required parameters
    if (!code || !state) {
      return new Response('Missing code or state parameter', { status: 400 });
    }

    // Validate state (CSRF protection)
    const cookieStore = await cookies();
    const savedState = cookieStore.get('podio_oauth_state')?.value;

    if (!savedState || savedState !== state) {
      return new Response('Invalid state parameter (CSRF protection)', { status: 400 });
    }

    // Exchange code for tokens
    const config = loadPodioConfig();
    // Use PODIO_REDIRECT_URI if set (for localtunnel), otherwise use request origin
    const redirectUri = process.env.PODIO_REDIRECT_URI || `${req.nextUrl.origin}/api/auth/podio/callback`;
    const tokens = await exchangeCodeForToken(
      config,
      code,
      redirectUri
    );

    // Save tokens
    await saveTokens(tokens);

    // Clear state cookie
    const response = new Response(
      `<!DOCTYPE html>
      <html>
        <head>
          <title>Authorization Successful</title>
          <meta http-equiv="refresh" content="3;url=/">
        </head>
        <body style="font-family: system-ui, sans-serif; max-width: 600px; margin: 100px auto; text-align: center;">
          <h1>✅ Authorization Successful!</h1>
          <p>Your Podio account has been connected.</p>
          <p>Redirecting you back to the app...</p>
          <p><a href="/">Click here if not redirected automatically</a></p>
        </body>
      </html>`,
      {
        status: 200,
        headers: {
          'Content-Type': 'text/html',
          'Set-Cookie': 'podio_oauth_state=; Path=/; HttpOnly; Max-Age=0',
        },
      }
    );

    return response;
  } catch (error) {
    console.error('OAuth callback error:', error);

    return new Response(
      `<!DOCTYPE html>
      <html>
        <head><title>Authorization Error</title></head>
        <body style="font-family: system-ui, sans-serif; max-width: 600px; margin: 100px auto;">
          <h1>❌ Authorization Error</h1>
          <p>${error instanceof Error ? error.message : 'Unknown error occurred'}</p>
          <p><a href="/">Return to home</a></p>
        </body>
      </html>`,
      {
        status: 500,
        headers: { 'Content-Type': 'text/html' },
      }
    );
  }
}
