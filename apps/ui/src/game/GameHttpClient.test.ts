import {
  type GameActionRequest,
  GAMEPLAY_PROTOCOL_HEADER,
  GAMEPLAY_PROTOCOL_VERSION,
} from '@dungeon-crawler/protocol/schemas';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { gameWebSocketUrl, normalizeApiBaseUrl } from '@/config/apiBaseUrl';
import {
  GameApiError,
  GameHttpClient,
  GameNetworkError,
  GameProtocolError,
  GameProtocolMismatchError,
  GameRequestTimeoutError,
} from '@/game/GameHttpClient';
import { StoreHelpers } from '@/test/helpers/storeHelpers';

const credential = {
  gameId: 'client-game',
  sessionToken: 'client-secret-token',
};
const state = StoreHelpers.visibleGameState({ _id: credential.gameId });

describe('GameHttpClient', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('derives credential-free WS and WSS URLs from the API base', () => {
    expect(
      gameWebSocketUrl(credential.gameId, '/api', 'http://localhost:5173/play'),
    ).toBe('ws://localhost:5173/api/games/client-game/stream');
    expect(
      gameWebSocketUrl(credential.gameId, '', 'http://localhost:5173/play'),
    ).toBe('ws://localhost:5173/games/client-game/stream');
    const production = gameWebSocketUrl(
      credential.gameId,
      'https://api.example.com',
      'https://ui.example.com',
    );
    expect(production).toBe('wss://api.example.com/games/client-game/stream');
    expect(production).not.toContain(credential.sessionToken);
  });

  it('invokes the native global fetch with its required browser receiver', async () => {
    const receiverSensitiveFetch = vi.fn(function (
      this: typeof globalThis,
    ): Promise<Response> {
      if (this !== globalThis) throw new TypeError('Illegal invocation');
      return Promise.resolve(
        jsonResponse({
          gameId: credential.gameId,
          sessionToken: credential.sessionToken,
          revision: 0,
          state,
        }),
      );
    });
    vi.stubGlobal('fetch', receiverSensitiveFetch);
    const client = new GameHttpClient({ baseUrl: '/api' });

    await expect(
      client.createGame({ playerName: 'Ada', character: 'wizard' }),
    ).resolves.toMatchObject({ gameId: credential.gameId });
    expect(receiverSensitiveFetch).toHaveBeenCalledOnce();
  });

  it('uses canonical routes, bearer headers, exact action bodies, and strict schemas', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse(
          {
            gameId: credential.gameId,
            sessionToken: credential.sessionToken,
            revision: 0,
            state,
          },
          201,
        ),
      )
      .mockResolvedValueOnce(jsonResponse({ revision: 0, state }))
      .mockResolvedValueOnce(
        jsonResponse({
          actionId: 'action-1',
          revision: 1,
          state: { ...state, revision: 1 },
          events: [],
          deltas: [],
        }),
      )
      .mockResolvedValueOnce(emptyResponse(204));
    const client = new GameHttpClient({ baseUrl: '/api', fetch: fetchMock });
    const request: GameActionRequest = {
      actionId: 'action-1',
      expectedRevision: 0,
      command: { type: 'move', direction: 'right' },
    };
    const body = JSON.stringify(request);

    await client.createGame({ playerName: 'Ada', character: 'wizard' });
    await client.loadGame(credential);
    await client.executeAction(credential, body);
    await client.abandonGame(credential);

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/games',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ playerName: 'Ada', character: 'wizard' }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/games/client-game',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: `Bearer ${credential.sessionToken}`,
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      '/api/games/client-game/actions',
      expect.objectContaining({ body }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      '/api/games/client-game',
      expect.objectContaining({ method: 'DELETE' }),
    );

    for (const [url, options] of fetchMock.mock.calls.slice(1)) {
      expect(String(url)).not.toContain(credential.sessionToken);
      expect(String(options?.body ?? '')).not.toContain(
        credential.sessionToken,
      );
    }
    for (const [, options] of fetchMock.mock.calls) {
      expect(options?.headers).toEqual(
        expect.objectContaining({
          [GAMEPLAY_PROTOCOL_HEADER]: GAMEPLAY_PROTOCOL_VERSION,
        }),
      );
    }
  });

  it('migrates a legacy game through the one-time canonical route', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse({
        gameId: credential.gameId,
        sessionToken: credential.sessionToken,
        revision: 0,
        state,
      }),
    );
    const client = new GameHttpClient({ baseUrl: '/api/', fetch: fetchMock });

    await client.migrateLegacyGame(credential.gameId);

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/games/client-game/migrate',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('aborts a stalled request at the configured deadline', async () => {
    const fetchMock = vi.fn<typeof fetch>((_input, init) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        });
      });
    });
    const client = new GameHttpClient({
      baseUrl: '/api',
      fetch: fetchMock,
      requestTimeoutMs: 5,
    });

    await expect(client.loadGame(credential)).rejects.toBeInstanceOf(
      GameRequestTimeoutError,
    );
  });

  it.each([
    [undefined, '/api'],
    ['', '/api'],
    ['   ', '/api'],
    ['/', ''],
    ['/custom/', '/custom'],
    ['https://example.com/api/', 'https://example.com/api'],
  ])('normalizes API base %j', (value, expected) => {
    expect(normalizeApiBaseUrl(value)).toBe(expected);
  });

  it.each([
    'api',
    '//example.com/api',
    'ftp://example.com/api',
    'https://user:password@example.com/api',
  ])('rejects malformed API base %s', (value) => {
    expect(() => normalizeApiBaseUrl(value)).toThrow(TypeError);
  });

  it.each([
    ['missing', null],
    ['mismatched', '0'],
  ])(
    'rejects a %s protocol version before applying success',
    async (_name, version) => {
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          jsonResponse({ revision: 0, state }, 200, version),
        );

      const client = new GameHttpClient({ baseUrl: '/api', fetch: fetchMock });

      await expect(client.loadGame(credential)).rejects.toBeInstanceOf(
        GameProtocolMismatchError,
      );
    },
  );

  it('maps a server-side protocol rejection before reading application data', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse(
        {
          error: 'This client is incompatible with the game server',
          code: 'PROTOCOL_MISMATCH',
        },
        409,
      ),
    );
    const client = new GameHttpClient({ baseUrl: '/api', fetch: fetchMock });

    await expect(
      client.createGame({ playerName: 'Ada', character: 'wizard' }),
    ).rejects.toBeInstanceOf(GameProtocolMismatchError);
  });

  it('requires the protocol version on typed errors and 204 deletion', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse(
          { error: 'Unavailable', code: 'DATABASE_UNAVAILABLE' },
          503,
          null,
        ),
      )
      .mockResolvedValueOnce(emptyResponse(204, null));
    const client = new GameHttpClient({ baseUrl: '/api', fetch: fetchMock });

    await expect(client.loadGame(credential)).rejects.toBeInstanceOf(
      GameProtocolMismatchError,
    );
    await expect(client.abandonGame(credential)).rejects.toBeInstanceOf(
      GameProtocolMismatchError,
    );
  });

  it('treats an unversioned proxy failure as a network error', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('Bad Gateway', { status: 502 }));
    const client = new GameHttpClient({ baseUrl: '/api', fetch: fetchMock });

    await expect(client.loadGame(credential)).rejects.toBeInstanceOf(
      GameNetworkError,
    );
  });

  it('rejects malformed success and typed-error payloads at runtime', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ revision: 0 }))
      .mockResolvedValueOnce(jsonResponse({ error: 'Unsafe shape' }, 503));
    const client = new GameHttpClient({ baseUrl: '/api', fetch: fetchMock });

    await expect(client.loadGame(credential)).rejects.toBeInstanceOf(
      GameProtocolError,
    );
    await expect(client.loadGame(credential)).rejects.toBeInstanceOf(
      GameProtocolError,
    );
  });

  it('parses typed rate limits and derives retry eligibility from Retry-After', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse(
        {
          error: 'Wait briefly',
          code: 'RATE_LIMITED',
          actionId: 'action-1',
        },
        429,
        GAMEPLAY_PROTOCOL_VERSION,
        { 'Retry-After': '3' },
      ),
    );
    const client = new GameHttpClient({
      baseUrl: '/api',
      fetch: fetchMock,
      now: () => 1_000,
    });

    const error = await client
      .executeAction(
        credential,
        JSON.stringify({
          actionId: 'action-1',
          expectedRevision: 0,
          command: { type: 'attack' },
        }),
      )
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(GameApiError);
    expect(error).toMatchObject({ status: 429, retryAt: 4_000 });
    expect(JSON.stringify(error)).not.toContain(credential.sessionToken);
  });

  it('rejects a rate limit without server retry timing as malformed protocol', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ error: 'Wait briefly', code: 'RATE_LIMITED' }, 429),
      );
    const client = new GameHttpClient({ baseUrl: '/api', fetch: fetchMock });

    await expect(client.loadGame(credential)).rejects.toThrow(
      'omitted its retry timing',
    );
  });
});

function jsonResponse(
  body: unknown,
  status = 200,
  version: string | null = GAMEPLAY_PROTOCOL_VERSION,
  extraHeaders: HeadersInit = {},
): Response {
  const headers = new Headers(extraHeaders);
  headers.set('Content-Type', 'application/json');
  if (version !== null) headers.set(GAMEPLAY_PROTOCOL_HEADER, version);
  return new Response(JSON.stringify(body), { status, headers });
}

function emptyResponse(
  status: number,
  version: string | null = GAMEPLAY_PROTOCOL_VERSION,
): Response {
  const headers = new Headers();
  if (version !== null) headers.set(GAMEPLAY_PROTOCOL_HEADER, version);
  return new Response(null, { status, headers });
}
