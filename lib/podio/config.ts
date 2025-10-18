import { z } from 'zod';

/**
 * Podio API Configuration Schema
 * Validates environment variables required for Podio integration
 */
const PodioConfigSchema = z.object({
  clientId: z.string().min(1, 'PODIO_CLIENT_ID is required'),
  clientSecret: z.string().min(1, 'PODIO_CLIENT_SECRET is required'),
  username: z.string().email('PODIO_USERNAME must be a valid email'),
  password: z.string().min(1, 'PODIO_PASSWORD is required'),
  apiBase: z.string().url('PODIO_API_BASE must be a valid URL').default('https://api.podio.com'),
  phase2Enabled: z.boolean().default(false),
});

export type PodioConfig = z.infer<typeof PodioConfigSchema>;

/**
 * Load and validate Podio configuration from environment variables
 *
 * @throws {Error} If required environment variables are missing or invalid
 * @returns {PodioConfig} Validated Podio configuration
 */
export function loadPodioConfig(): PodioConfig {
  try {
    const config = PodioConfigSchema.parse({
      clientId: process.env.PODIO_CLIENT_ID,
      clientSecret: process.env.PODIO_CLIENT_SECRET,
      username: process.env.PODIO_USERNAME,
      password: process.env.PODIO_PASSWORD,
      apiBase: process.env.PODIO_API_BASE || 'https://api.podio.com',
      phase2Enabled: process.env.PODIO_PHASE2_ENABLED === 'true',
    });

    return config;
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issues = error.issues.map(issue => `  - ${issue.path.join('.')}: ${issue.message}`).join('\n');
      throw new Error(
        `Podio configuration validation failed:\n${issues}\n\n` +
        `Please ensure all required Podio environment variables are set in .env.local`
      );
    }
    throw error;
  }
}

/**
 * Check if Podio Phase 2 features are enabled
 *
 * @returns {boolean} True if Phase 2 features are enabled
 */
export function isPodioPhase2Enabled(): boolean {
  return process.env.PODIO_PHASE2_ENABLED === 'true';
}

/**
 * Get missing Podio configuration fields
 * Useful for UI to display what configuration is needed
 *
 * @returns {string[]} Array of missing configuration field names
 */
export function getMissingPodioConfig(): string[] {
  const missing: string[] = [];

  if (!process.env.PODIO_CLIENT_ID) missing.push('PODIO_CLIENT_ID');
  if (!process.env.PODIO_CLIENT_SECRET) missing.push('PODIO_CLIENT_SECRET');
  if (!process.env.PODIO_USERNAME) missing.push('PODIO_USERNAME');
  if (!process.env.PODIO_PASSWORD) missing.push('PODIO_PASSWORD');

  return missing;
}

/**
 * Check if Podio configuration is complete
 *
 * @returns {boolean} True if all required Podio configuration is present
 */
export function isPodioConfigured(): boolean {
  return getMissingPodioConfig().length === 0;
}
