import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const SESSION_TOKEN_BYTES = 32;

/**
 * Tokens contain 256 bits of entropy, so a one-way SHA-256 digest is suitable
 * for storage without the cost and denial-of-service risk of password KDFs.
 */
export function createSessionToken(): string {
  return randomBytes(SESSION_TOKEN_BYTES).toString('base64url');
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('base64url');
}

export function sessionTokenMatches(
  token: string,
  storedHash: string,
): boolean {
  const candidate = Buffer.from(hashSessionToken(token), 'base64url');
  const stored = Buffer.from(storedHash, 'base64url');
  return (
    candidate.length === stored.length && timingSafeEqual(candidate, stored)
  );
}
