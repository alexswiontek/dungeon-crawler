import { describe, expect, it } from 'vitest';
import { createOriginMatcher, parseAllowedOrigins } from './allowedOrigins.js';

const PREVIEW =
  'https://dungeon-crawler-ui-*-alexs-projects-19b7b594.vercel.app';

describe('parseAllowedOrigins', () => {
  it('falls back to the dev server only when nothing is configured', () => {
    expect(parseAllowedOrigins(undefined)).toEqual(['http://localhost:5173']);
    expect(parseAllowedOrigins('')).toEqual([]);
  });

  it('splits on commas, trimming blanks', () => {
    expect(
      parseAllowedOrigins(' https://a.example , ,https://b.example '),
    ).toEqual(['https://a.example', 'https://b.example']);
  });
});

describe('createOriginMatcher', () => {
  it('matches exact origins and nothing else', () => {
    const isAllowed = createOriginMatcher(['https://play.example.com']);

    expect(isAllowed('https://play.example.com')).toBe(true);
    expect(isAllowed('https://play.example.com.evil.test')).toBe(false);
    expect(isAllowed('http://play.example.com')).toBe(false);
  });

  it('matches any Vercel preview under the configured project', () => {
    const isAllowed = createOriginMatcher([PREVIEW]);

    expect(
      isAllowed(
        'https://dungeon-crawler-ui-git-feat-x-alexs-projects-19b7b594.vercel.app',
      ),
    ).toBe(true);
    expect(
      isAllowed(
        'https://dungeon-crawler-ui-9k2h4d-alexs-projects-19b7b594.vercel.app',
      ),
    ).toBe(true);
  });

  it('rejects another account reusing the prefix', () => {
    const isAllowed = createOriginMatcher([PREVIEW]);

    expect(
      isAllowed('https://dungeon-crawler-ui-x-someone-elses-team.vercel.app'),
    ).toBe(false);
    expect(isAllowed('https://dungeon-crawler-ui-x.attacker.test')).toBe(false);
  });

  it('stops a wildcard at a label boundary', () => {
    const isAllowed = createOriginMatcher(['https://*.example.com']);

    expect(isAllowed('https://preview.example.com')).toBe(true);
    expect(isAllowed('https://a.b.example.com')).toBe(false);
  });

  it('treats dots in a pattern as literal', () => {
    const isAllowed = createOriginMatcher(['https://*.example.com']);

    expect(isAllowed('https://previewxexample.com')).toBe(false);
  });

  it('accepts a mix of exact and wildcard entries', () => {
    const isAllowed = createOriginMatcher([
      'https://play.example.com',
      PREVIEW,
    ]);

    expect(isAllowed('https://play.example.com')).toBe(true);
    expect(
      isAllowed(
        'https://dungeon-crawler-ui-abc-alexs-projects-19b7b594.vercel.app',
      ),
    ).toBe(true);
    expect(isAllowed('https://elsewhere.example.com')).toBe(false);
  });

  it('allows nothing when nothing is configured', () => {
    expect(createOriginMatcher([])('https://play.example.com')).toBe(false);
  });
});
