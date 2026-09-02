import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, GameApiError, GameNetworkError } from '@/api';
import { useGameCommands } from '@/hooks/useGameCommands';
import { StoreHelpers } from '@/test/helpers/storeHelpers';

const initialState = StoreHelpers.visibleGameState({ _id: 'hook-game' });
const initialGame = { revision: 0, state: initialState };

describe('useGameCommands', () => {
  beforeEach(() => {
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(
      '00000000-0000-4000-8000-000000000001',
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('serializes input and retains the exact action identity and body for an ambiguous retry', async () => {
    const first = deferred<never>();
    const execute = vi
      .spyOn(api, 'executeAction')
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce({
        actionId: '00000000-0000-4000-8000-000000000001',
        revision: 1,
        state: { ...initialState, revision: 1 },
        events: [],
        deltas: [],
      });
    const { result } = renderHook(() =>
      useGameCommands('hook-game', 'hook-token', {
        initialGame,
        onSessionInvalid: vi.fn(),
      }),
    );
    await waitFor(() => expect(result.current.hasPlayer).toBe(true));

    act(() => result.current.sendMove('right'));
    act(() => result.current.sendAttack());
    expect(execute).toHaveBeenCalledOnce();
    const original = execute.mock.calls[0][2];
    const originalBody = JSON.stringify(original);

    await act(async () => first.reject(new GameNetworkError()));
    await waitFor(() => expect(result.current.retryAvailable).toBe(true));
    act(() => result.current.sendAttack());
    expect(execute).toHaveBeenCalledOnce();

    act(() => result.current.retryAction());
    await waitFor(() => expect(execute).toHaveBeenCalledTimes(2));
    expect(execute.mock.calls[1][2]).toBe(original);
    expect(JSON.stringify(execute.mock.calls[1][2])).toBe(originalBody);
    await waitFor(() => expect(result.current.gameState.revision).toBe(1));
    expect(result.current.retryAvailable).toBe(false);
  });

  it('applies conflict state before accepting a new action at the safe revision', async () => {
    const synchronized = StoreHelpers.visibleGameState({
      _id: 'hook-game',
      revision: 5,
      player: { x: 9, y: 5 },
    });
    const execute = vi
      .spyOn(api, 'executeAction')
      .mockRejectedValueOnce(
        new GameApiError(409, {
          error: 'Synchronize first',
          code: 'REVISION_CONFLICT',
          actionId: '00000000-0000-4000-8000-000000000001',
          revision: 5,
          state: synchronized,
        }),
      )
      .mockImplementationOnce(async (_gameId, _token, request) => ({
        actionId: request.actionId,
        revision: 6,
        state: { ...synchronized, revision: 6 },
        events: [],
        deltas: [],
      }));
    const { result } = renderHook(() =>
      useGameCommands('hook-game', 'hook-token', {
        initialGame,
        onSessionInvalid: vi.fn(),
      }),
    );
    await waitFor(() => expect(result.current.hasPlayer).toBe(true));

    act(() => result.current.sendAttack());
    await waitFor(() => expect(result.current.gameState.revision).toBe(5));
    expect(result.current.gameState.player?.x).toBe(9);

    act(() => result.current.sendMove('left'));
    await waitFor(() => expect(execute).toHaveBeenCalledTimes(2));
    expect(execute.mock.calls[1][2].expectedRevision).toBe(5);
  });

  it.each([
    'UNAUTHORIZED',
    'GAME_NOT_FOUND',
  ] as const)('returns to recovery for %s without retrying', async (code) => {
    vi.spyOn(api, 'executeAction').mockRejectedValueOnce(
      new GameApiError(code === 'UNAUTHORIZED' ? 401 : 404, {
        error: 'Game unavailable',
        code,
      }),
    );
    const onSessionInvalid = vi.fn();
    const { result } = renderHook(() =>
      useGameCommands('hook-game', 'hook-token', {
        initialGame,
        onSessionInvalid,
      }),
    );
    await waitFor(() => expect(result.current.hasPlayer).toBe(true));

    act(() => result.current.sendAttack());
    await waitFor(() => expect(onSessionInvalid).toHaveBeenCalledOnce());
    expect(result.current.retryAvailable).toBe(false);
  });
});

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
