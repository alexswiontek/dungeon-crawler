import {
  GAMEPLAY_PROTOCOL_HEADER,
  GAMEPLAY_PROTOCOL_VERSION,
} from '@dungeon-crawler/protocol';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '@/App';
import {
  ACTIVE_GAME_CREDENTIAL_KEY,
  ACTIVE_GAME_METADATA_KEY,
} from '@/game/GameSessionStorage';
import { StoreHelpers } from '@/test/helpers/storeHelpers';

describe('application lifecycle', () => {
  let stored: Map<string, string>;

  beforeEach(() => {
    stored = new Map();
    vi.mocked(localStorage.getItem).mockImplementation(
      (key: string) => stored.get(key) ?? null,
    );
    vi.mocked(localStorage.setItem).mockImplementation(
      (key: string, value: string) => {
        stored.set(key, value);
      },
    );
    vi.mocked(localStorage.removeItem).mockImplementation((key: string) => {
      stored.delete(key);
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('preserves a saved credential after transient restoration failure and retries load', async () => {
    saveCredentialPair();
    const active = StoreHelpers.visibleGameState({ _id: 'saved-game' });
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockRejectedValueOnce(new Error('network unavailable'))
        .mockResolvedValueOnce(jsonResponse({ revision: 0, state: active })),
    );

    render(<App />);
    expect(await screen.findByText('Saved game unavailable')).toBeTruthy();
    expect(stored.has(ACTIVE_GAME_METADATA_KEY)).toBe(true);
    expect(stored.has(ACTIVE_GAME_CREDENTIAL_KEY)).toBe(true);

    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: 'Retry Load' }));
    expect(
      await screen.findByRole('application', {
        name: 'Dungeon Crawler game',
      }),
    ).toBeTruthy();
  });

  it.each([
    ['UNAUTHORIZED', 401],
    ['GAME_NOT_FOUND', 404],
  ] as const)('clears an invalid restored session for %s', async (code, status) => {
    saveCredentialPair();
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          jsonResponse({ error: 'Unavailable', code }, status),
        ),
    );

    render(<App />);

    expect(
      await screen.findByText(
        'That saved game is no longer available. Start a new game.',
      ),
    ).toBeTruthy();
    expect(stored.has(ACTIVE_GAME_METADATA_KEY)).toBe(false);
    expect(stored.has(ACTIVE_GAME_CREDENTIAL_KEY)).toBe(false);
  });

  it.each([
    'dead',
    'won',
  ] as const)('restores a %s game to its terminal screen', async (status) => {
    saveCredentialPair();
    const terminal = StoreHelpers.visibleGameState({
      _id: 'saved-game',
      revision: 8,
      status,
    });
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(jsonResponse({ revision: 8, state: terminal })),
    );

    render(<App />);

    expect(
      await screen.findByRole('heading', {
        name: status === 'won' ? 'Victory!' : 'Game Over',
      }),
    ).toBeTruthy();
    expect(stored.has(ACTIVE_GAME_METADATA_KEY)).toBe(false);
    expect(stored.has(ACTIVE_GAME_CREDENTIAL_KEY)).toBe(false);
  });

  it('blocks an incompatible tab without deleting its valid credential pair', async () => {
    saveCredentialPair();
    const active = StoreHelpers.visibleGameState({ _id: 'saved-game' });
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          jsonResponse({ revision: 0, state: active }, 200, '0'),
        ),
    );

    render(<App />);

    expect(await screen.findByText('Reload required')).toBeTruthy();
    expect(stored.has(ACTIVE_GAME_METADATA_KEY)).toBe(true);
    expect(stored.has(ACTIVE_GAME_CREDENTIAL_KEY)).toBe(true);
  });

  it('does not claim abandon success before deletion and offers a retry', async () => {
    const state = StoreHelpers.visibleGameState({ _id: 'new-game' });
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse(
          {
            gameId: 'new-game',
            sessionToken: 'new-secret',
            revision: 0,
            state,
          },
          201,
        ),
      )
      .mockRejectedValueOnce(new Error('delete interrupted'))
      .mockResolvedValueOnce(emptyResponse(204));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<App />);
    await user.type(await screen.findByRole('textbox'), 'Ada');
    await user.click(screen.getByRole('button', { name: 'Start Game' }));
    await screen.findByRole('application', { name: 'Dungeon Crawler game' });

    await user.click(screen.getByRole('button', { name: 'Restart' }));
    const restartButtons = screen.getAllByRole('button', { name: 'Restart' });
    const confirmation = restartButtons[restartButtons.length - 1];
    expect(confirmation).toBeDefined();
    if (!confirmation) throw new Error('Restart confirmation was not shown.');
    await user.click(confirmation);
    expect(await screen.findByText('Abandonment failed')).toBeTruthy();
    expect(stored.has(ACTIVE_GAME_CREDENTIAL_KEY)).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Retry Abandon' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Start Game' })).toBeTruthy(),
    );
    expect(stored.has(ACTIVE_GAME_CREDENTIAL_KEY)).toBe(false);
  });

  function saveCredentialPair(): void {
    stored.set(
      ACTIVE_GAME_METADATA_KEY,
      JSON.stringify({
        storageVersion: 1,
        protocolVersion: GAMEPLAY_PROTOCOL_VERSION,
        gameId: 'saved-game',
        savedAt: Date.now(),
      }),
    );
    stored.set(
      ACTIVE_GAME_CREDENTIAL_KEY,
      JSON.stringify({
        storageVersion: 1,
        protocolVersion: GAMEPLAY_PROTOCOL_VERSION,
        sessionToken: 'saved-secret',
      }),
    );
  }
});

function jsonResponse(
  body: unknown,
  status = 200,
  version: string = GAMEPLAY_PROTOCOL_VERSION,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      [GAMEPLAY_PROTOCOL_HEADER]: version,
    },
  });
}

function emptyResponse(status: number): Response {
  return new Response(null, {
    status,
    headers: { [GAMEPLAY_PROTOCOL_HEADER]: GAMEPLAY_PROTOCOL_VERSION },
  });
}
