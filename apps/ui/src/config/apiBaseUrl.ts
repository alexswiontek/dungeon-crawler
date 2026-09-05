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
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new TypeError('VITE_API_URL must be a root-relative or HTTP URL.');
  }
  return candidate.replace(/\/+$/, '');
}

export const API_BASE_URL = normalizeApiBaseUrl(import.meta.env.VITE_API_URL);

export function gameWebSocketUrl(
  gameId: string,
  baseUrl = API_BASE_URL,
  pageUrl = window.location.href,
): string {
  const url = new URL(baseUrl || '/', pageUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/games/${encodeURIComponent(gameId)}/stream`;
  url.search = '';
  url.hash = '';
  return url.toString();
}
