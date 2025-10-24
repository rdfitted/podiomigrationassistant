/**
 * Helper to mask PII (emails, phone numbers, etc.) in logs.
 * Centralized to keep masking behavior consistent across modules.
 * @param value - Value to mask.
 * @returns Masked string suitable for logging.
 */
export function maskPII(value: unknown): string {
  const str = String(value ?? '');

  // Email-like pattern - mask both local and domain for strict privacy compliance.
  if (str.includes('@')) {
    const [local, domain = ''] = str.split('@');
    const maskedLocal = local.length > 2 ? `${local.slice(0, 2)}***` : '***';
    const maskedDomain = domain.length > 4 ? `${domain.slice(0, 2)}***` : '***';
    return `${maskedLocal}@${maskedDomain}`;
  }

  // Other values: show first 2 and last 2 chars when long enough, otherwise fully mask.
  return str.length > 6 ? `${str.slice(0, 2)}***${str.slice(-2)}` : '***';
}

