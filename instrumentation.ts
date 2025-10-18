/**
 * Next.js Instrumentation
 * Server-side initialization for migration system
 * This file is automatically loaded by Next.js on server startup
 */

export async function register() {
  // Only run on server (not in build process or Edge Runtime)
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    console.log('🚀 Initializing migration system...');

    // Dynamic import to avoid Edge Runtime compatibility issues
    const { registerShutdownHandlers } = await import('./lib/migration/shutdown-handler');

    // Register process signal handlers for graceful shutdown
    registerShutdownHandlers();

    console.log('✅ Migration system initialized');
    console.log('   - Shutdown handlers registered (SIGTERM, SIGINT, SIGUSR2)');
    console.log('   - Graceful pause/resume enabled');
  }
}
