const DEFAULT_ALLOWED_ORIGINS = ['http://localhost:5173'];

const REGEXP_METACHARACTERS = /[.*+?^${}()|[\]\\]/g;

function toPattern(entry: string): RegExp | string {
  if (!entry.includes('*')) return entry;
  const source = entry
    .split('*')
    .map((literal) => literal.replace(REGEXP_METACHARACTERS, '\\$&'))
    .join('[^.]*');
  return new RegExp(`^${source}$`);
}

export function parseAllowedOrigins(raw: string | undefined): string[] {
  const entries = raw === undefined ? DEFAULT_ALLOWED_ORIGINS : raw.split(',');
  return entries.map((entry) => entry.trim()).filter((entry) => entry !== '');
}

/** Builds an origin test where `*` stands for part of one hostname label. */
export function createOriginMatcher(
  entries: string[],
): (origin: string) => boolean {
  const patterns = entries.map(toPattern);
  return (origin) =>
    patterns.some((pattern) =>
      typeof pattern === 'string' ? pattern === origin : pattern.test(origin),
    );
}
