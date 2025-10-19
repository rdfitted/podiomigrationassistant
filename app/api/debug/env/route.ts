import { NextResponse } from 'next/server';

/**
 * Debug endpoint to check environment variables
 * WARNING: Remove this endpoint in production!
 */
export async function GET() {
  const config = {
    PODIO_CLIENT_ID: process.env.PODIO_CLIENT_ID
      ? `${process.env.PODIO_CLIENT_ID.substring(0, 10)}... (length: ${process.env.PODIO_CLIENT_ID.length})`
      : 'NOT SET',
    PODIO_CLIENT_SECRET: process.env.PODIO_CLIENT_SECRET
      ? `****** (length: ${process.env.PODIO_CLIENT_SECRET.length})`
      : 'NOT SET',
    PODIO_USERNAME: process.env.PODIO_USERNAME || 'NOT SET',
    PODIO_PASSWORD: process.env.PODIO_PASSWORD
      ? `****** (length: ${process.env.PODIO_PASSWORD.length})`
      : 'NOT SET',
    PODIO_API_BASE: process.env.PODIO_API_BASE || 'NOT SET (using default)',

    // Password diagnostics (without revealing the actual password)
    passwordDiagnostics: process.env.PODIO_PASSWORD ? {
      length: process.env.PODIO_PASSWORD.length,
      trimmedLength: process.env.PODIO_PASSWORD.trim().length,
      hasLeadingSpace: process.env.PODIO_PASSWORD[0] === ' ',
      hasTrailingSpace: process.env.PODIO_PASSWORD[process.env.PODIO_PASSWORD.length - 1] === ' ',
      firstCharCode: process.env.PODIO_PASSWORD.charCodeAt(0),
      lastCharCode: process.env.PODIO_PASSWORD.charCodeAt(process.env.PODIO_PASSWORD.length - 1),
    } : null,
  };

  return NextResponse.json(config, { status: 200 });
}
