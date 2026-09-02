export function normalizeApiBaseUrl(value: string | undefined): string {
  const candidate = value?.trim() || '/api';
  if (candidate.startsWith('/') && !candidate.startsWith('//')) {
    return candidate.replace(/\/+$/, '');
  }

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new TypeError('VITE_API_URL must be a root-relative or HTTP URL.');
  }
  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
    parsed.search ||
    parsed.hash
  ) {
    throw new TypeError('VITE_API_URL must be a root-relative or HTTP URL.');
  }
  return candidate.replace(/\/+$/, '');
}

export const API_BASE_URL = normalizeApiBaseUrl(import.meta.env.VITE_API_URL);
