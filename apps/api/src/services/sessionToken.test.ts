import { describe, expect, it } from 'vitest';
import {
  createSessionToken,
  hashSessionToken,
  sessionTokenMatches,
} from './sessionToken.js';

describe('session tokens', () => {
  it('creates distinct 256-bit bearer credentials', () => {
    const first = createSessionToken();
    const second = createSessionToken();

    expect(first).not.toBe(second);
    expect(Buffer.from(first, 'base64url')).toHaveLength(32);
    expect(Buffer.from(second, 'base64url')).toHaveLength(32);
  });

  it('stores and safely compares only a one-way digest', () => {
    const token = createSessionToken();
    const hash = hashSessionToken(token);

    expect(hash).not.toBe(token);
    expect(sessionTokenMatches(token, hash)).toBe(true);
    expect(sessionTokenMatches(createSessionToken(), hash)).toBe(false);
  });
});
