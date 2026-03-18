import { createHash, randomBytes, timingSafeEqual } from 'crypto';

/** Generate a new API key: rk_<64 random hex chars> */
export function generateApiKey(): string {
  return `rk_${randomBytes(32).toString('hex')}`;
}

/** Hash an API key with SHA-256 for storage. */
export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

/** Timing-safe comparison of a provided key against a stored hash. */
export function verifyApiKey(provided: string, storedHash: string): boolean {
  const providedHash = hashApiKey(provided);
  try {
    return timingSafeEqual(
      Buffer.from(providedHash, 'hex'),
      Buffer.from(storedHash, 'hex'),
    );
  } catch {
    return false;
  }
}

/** Generate a short random ID (24 hex chars). */
export function generateId(): string {
  return randomBytes(12).toString('hex');
}
