import type { GameActionRequest } from '@dungeon-crawler/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, GameNetworkError } from '@/api';
import { StoreHelpers } from '@/test/helpers/storeHelpers';

const TOKEN = 'client-session-token';
const state = StoreHelpers.visibleGameState({ _id: 'client-game' });

describe('HTTP game API', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses canonical routes and parses create, read, action, and delete responses', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          {
            gameId: 'client-game',
            sessionToken: TOKEN,
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
      .mockResolvedValueOnce(jsonResponse(undefined, 204));
    vi.stubGlobal('fetch', fetchMock);

    await expect(api.createGame('Ada', 'wizard')).resolves.toMatchObject({
      gameId: 'client-game',
      sessionToken: TOKEN,
    });
    await expect(api.getGame('client-game', TOKEN)).resolves.toMatchObject({
      revision: 0,
    });
    const action: GameActionRequest = {
      actionId: 'action-1',
      expectedRevision: 0,
      command: { type: 'attack' },
    };
    await expect(
      api.executeAction('client-game', TOKEN, action),
    ).resolves.toMatchObject({ actionId: 'action-1', revision: 1 });
    await expect(api.deleteGame('client-game', TOKEN)).resolves.toBeUndefined();

    expect(fetchMock.mock.calls[0][0]).toBe('/api/games');
    expect(fetchMock.mock.calls[1][0]).toBe('/api/games/client-game');
    expect(fetchMock.mock.calls[2][0]).toBe('/api/games/client-game/actions');
    expect(fetchMock.mock.calls[3][0]).toBe('/api/games/client-game');
    for (const call of fetchMock.mock.calls.slice(1)) {
      expect(call[1]?.headers).toMatchObject({
        Authorization: `Bearer ${TOKEN}`,
      });
      expect(String(call[0])).not.toContain(TOKEN);
    }
    expect(fetchMock.mock.calls[2][1]?.body).toBe(JSON.stringify(action));
    expect(String(fetchMock.mock.calls[2][1]?.body)).not.toContain(TOKEN);
  });

  it.each([
    ['create', () => api.createGame('Ada', 'wizard')],
    ['read', () => api.getGame('client-game', TOKEN)],
    [
      'action',
      () =>
        api.executeAction('client-game', TOKEN, {
          actionId: 'action-1',
          expectedRevision: 0,
          command: { type: 'attack' },
        }),
    ],
  ])('rejects a malformed %s success response through its runtime schema', async (_name, request) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ revision: 'not-a-number' })),
    );
    await expect(request()).rejects.toBeInstanceOf(GameNetworkError);
  });

  it('parses typed errors and rejects unsafe error bodies', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          { error: 'Synchronize first', code: 'REVISION_CONFLICT' },
          409,
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          {
            error: 'Synchronize first',
            code: 'REVISION_CONFLICT',
            sessionToken: TOKEN,
          },
          409,
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      api.executeAction('client-game', TOKEN, {
        actionId: 'action-1',
        expectedRevision: 0,
        command: { type: 'attack' },
      }),
    ).rejects.toMatchObject({
      status: 409,
      response: { code: 'REVISION_CONFLICT' },
    });
    await expect(
      api.executeAction('client-game', TOKEN, {
        actionId: 'action-2',
        expectedRevision: 0,
        command: { type: 'attack' },
      }),
    ).rejects.toBeInstanceOf(GameNetworkError);
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}
