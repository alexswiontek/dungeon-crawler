import type { GameCommandResult } from '@dungeon-crawler/protocol/schemas';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CommandQueueOverflowError,
  GameGateway,
  RetryNotReadyError,
} from '@/game/GameGateway';
import {
  GameApiError,
  GameNetworkError,
  GameProtocolMismatchError,
  type GameTransport,
} from '@/game/GameHttpClient';
import type { ActiveGameStorage } from '@/game/GameSessionStorage';
import { StoreHelpers } from '@/test/helpers/storeHelpers';

const credential = { gameId: 'gateway-game', sessionToken: 'gateway-secret' };

describe('GameGateway', () => {
  let transport: {
    createGame: ReturnType<typeof vi.fn<GameTransport['createGame']>>;
    migrateLegacyGame: ReturnType<
      typeof vi.fn<GameTransport['migrateLegacyGame']>
    >;
    loadGame: ReturnType<typeof vi.fn<GameTransport['loadGame']>>;
    executeAction: ReturnType<typeof vi.fn<GameTransport['executeAction']>>;
    abandonGame: ReturnType<typeof vi.fn<GameTransport['abandonGame']>>;
  };
  let storage: {
    saveActiveGame: ReturnType<
      typeof vi.fn<ActiveGameStorage['saveActiveGame']>
    >;
    clearActiveGame: ReturnType<
      typeof vi.fn<ActiveGameStorage['clearActiveGame']>
    >;
    clearLegacyGame: ReturnType<
      typeof vi.fn<ActiveGameStorage['clearLegacyGame']>
    >;
  };
  let actionNumber: number;
  let now: number;

  beforeEach(() => {
    actionNumber = 0;
    now = 1_000;
    transport = {
      createGame: vi.fn(),
      migrateLegacyGame: vi.fn(),
      loadGame: vi.fn(),
      executeAction: vi.fn(),
      abandonGame: vi.fn(),
    };
    storage = {
      saveActiveGame: vi.fn().mockReturnValue(true),
      clearActiveGame: vi.fn(),
      clearLegacyGame: vi.fn(),
    };
  });

  it('creates and loads through one credential-private boundary', async () => {
    const initialState = visibleState();
    transport.createGame.mockResolvedValue({
      gameId: credential.gameId,
      sessionToken: credential.sessionToken,
      revision: 0,
      state: initialState,
    });
    const created = createGateway();

    const createResult = await created.createGame({
      playerName: 'Ada',
      character: 'wizard',
    });

    expect(transport.createGame).toHaveBeenCalledWith({
      playerName: 'Ada',
      character: 'wizard',
    });
    expect(storage.saveActiveGame).toHaveBeenCalledWith(credential);
    expect(createResult.model.getSnapshot()).toMatchObject({
      id: credential.gameId,
      revision: 0,
    });
    expect(JSON.stringify(created.getSnapshot())).not.toContain(
      credential.sessionToken,
    );

    transport.loadGame.mockResolvedValue({ revision: 0, state: initialState });
    const restored = createGateway(credential);
    await restored.loadGame();
    expect(transport.loadGame).toHaveBeenCalledWith(credential);
    expect(restored.getSnapshot().lifecycle.kind).toBe('playing');
  });

  it('promotes a legacy game and removes its old record only after credentials are stored', async () => {
    transport.migrateLegacyGame.mockResolvedValue({
      gameId: credential.gameId,
      sessionToken: credential.sessionToken,
      revision: 0,
      state: visibleState(),
    });
    const gateway = createGateway();

    await gateway.migrateLegacyGame(credential.gameId);

    expect(transport.migrateLegacyGame).toHaveBeenCalledWith(credential.gameId);
    expect(storage.saveActiveGame).toHaveBeenCalledWith(credential);
    expect(storage.clearLegacyGame).toHaveBeenCalledOnce();
    expect(gateway.getSnapshot().lifecycle.kind).toBe('playing');
  });

  it('does not apply an action response older than the current model', async () => {
    transport.loadGame.mockResolvedValueOnce({
      revision: 2,
      state: visibleState({ revision: 2 }),
    });
    const gateway = createGateway(credential);
    await gateway.loadGame();
    transport.executeAction.mockResolvedValueOnce({
      actionId: 'action-1',
      revision: 1,
      state: visibleState({ revision: 1 }),
      events: [],
      deltas: [],
    });

    const action = gateway.execute({ type: 'attack' });
    const rejection = expect(action).rejects.toBeInstanceOf(Error);

    await vi.waitFor(() => {
      expect(gateway.getSnapshot().lifecycle.kind).toBe('protocol-mismatch');
    });
    await rejection;
    expect(gateway.getModel().getSnapshot().revision).toBe(2);
  });

  it('dispatches three rapid inputs in FIFO order with sequential revisions', async () => {
    const gateway = await loadedGateway();
    const firstResponse = deferred<GameCommandResult>();
    transport.executeAction
      .mockReturnValueOnce(firstResponse.promise)
      .mockImplementationOnce(async (_credential, body) =>
        resultFor(body, 2, { player: { x: 4 } }),
      )
      .mockImplementationOnce(async (_credential, body) =>
        resultFor(body, 3, { player: { x: 3 } }),
      );

    const first = gateway.execute({ type: 'move', direction: 'right' });
    const second = gateway.execute({ type: 'move', direction: 'down' });
    const latest = gateway.execute({ type: 'move', direction: 'left' });
    expect(transport.executeAction).toHaveBeenCalledTimes(1);
    expect(gateway.getMetrics().queueDepth).toBe(3);

    const firstBody = actionBody(0);
    expect(firstBody).toMatchObject({
      actionId: 'action-1',
      expectedRevision: 0,
      command: { type: 'move', direction: 'right' },
    });
    firstResponse.resolve(resultFor(JSON.stringify(firstBody), 1));
    await first;
    await vi.waitFor(() =>
      expect(transport.executeAction).toHaveBeenCalledTimes(2),
    );

    const secondBody = actionBody(1);
    expect(secondBody).toMatchObject({
      actionId: 'action-2',
      expectedRevision: 1,
      command: { type: 'move', direction: 'down' },
    });
    await second;
    await vi.waitFor(() =>
      expect(transport.executeAction).toHaveBeenCalledTimes(3),
    );

    const latestBody = actionBody(2);
    expect(latestBody).toMatchObject({
      actionId: 'action-3',
      expectedRevision: 2,
      command: { type: 'move', direction: 'left' },
    });
    await latest;
    expect(gateway.getModel().getSnapshot()).toMatchObject({ revision: 3 });
    expect(gateway.getMetrics().queueDepth).toBe(0);
  });

  it('rejects the newest input visibly when the FIFO queue is full', async () => {
    transport.loadGame.mockResolvedValueOnce({
      revision: 0,
      state: visibleState(),
    });
    const gateway = new GameGateway({
      transport,
      storage,
      credential,
      actionId: () => `action-${++actionNumber}`,
      maxQueuedCommands: 3,
    });
    await gateway.loadGame();
    const response = deferred<GameCommandResult>();
    transport.executeAction.mockReturnValueOnce(response.promise);

    void gateway.execute({ type: 'attack' });
    void gateway.execute({ type: 'move', direction: 'right' });
    void gateway.execute({ type: 'move', direction: 'down' });
    await expect(
      gateway.execute({ type: 'move', direction: 'left' }),
    ).rejects.toBeInstanceOf(CommandQueueOverflowError);

    expect(gateway.getMetrics()).toMatchObject({
      queueDepth: 3,
      rejectedInputCount: 1,
    });
    expect(gateway.getSnapshot().lifecycle).toMatchObject({
      kind: 'command-failed',
      message: 'The command queue is full. The newest input was not accepted.',
    });
  });

  it('retains an exact ambiguous request and one queued intent through retry', async () => {
    const gateway = await loadedGateway();
    const interrupted = deferred<GameCommandResult>();
    transport.executeAction
      .mockReturnValueOnce(interrupted.promise)
      .mockImplementationOnce(async (_credential, body) => resultFor(body, 1))
      .mockImplementationOnce(async (_credential, body) => resultFor(body, 2));

    const first = gateway.execute({ type: 'move', direction: 'right' });
    const queued = gateway.execute({ type: 'attack' });
    interrupted.reject(new GameNetworkError());
    await vi.waitFor(() =>
      expect(gateway.getSnapshot().lifecycle.kind).toBe('retry-required'),
    );
    expect(gateway.getSnapshot().lifecycle).toMatchObject({
      message:
        'No response came back for this action. Retry Action will resend the same action without applying it twice.',
    });
    await expect(
      gateway.execute({ type: 'move', direction: 'left' }),
    ).rejects.toThrow('Resolve the pending action');

    const firstSerializedBody = serializedBody(0);
    const retryPromise = gateway.retryPendingAction();
    expect(retryPromise).toBe(first);
    await first;
    await vi.waitFor(() =>
      expect(transport.executeAction).toHaveBeenCalledTimes(3),
    );
    expect(serializedBody(1)).toBe(firstSerializedBody);
    expect(actionBody(2)).toMatchObject({
      actionId: 'action-2',
      expectedRevision: 1,
      command: { type: 'attack' },
    });
    await queued;
    expect(gateway.getMetrics()).toMatchObject({
      queueDepth: 0,
      retryCount: 1,
      ambiguousOutcomeCount: 1,
    });
  });

  it('applies conflict state and rebases later queued input', async () => {
    const gateway = await loadedGateway();
    const conflictState = visibleState({
      revision: 5,
      player: { x: 9, y: 8 },
    });
    transport.executeAction
      .mockImplementationOnce(async (_credential, body) => {
        const request = JSON.parse(body) as { actionId: string };
        throw new GameApiError(409, {
          error: 'Synchronize first',
          code: 'REVISION_CONFLICT',
          actionId: request.actionId,
          revision: 5,
          state: conflictState,
        });
      })
      .mockImplementationOnce(async (_credential, body) =>
        resultFor(body, 6, { player: { x: 8, y: 8 } }),
      );

    const rejected = gateway.execute({ type: 'move', direction: 'right' });
    const queued = gateway.execute({ type: 'attack' });

    await expect(rejected).rejects.toBeInstanceOf(GameApiError);
    await expect(queued).resolves.toMatchObject({ revision: 6 });
    expect(gateway.getModel().getSnapshot()).toMatchObject({ revision: 6 });
    expect(gateway.getModel().getSnapshot().player).toMatchObject({
      x: 8,
      y: 8,
    });
    expect(gateway.getSnapshot().lifecycle.kind).toBe('playing');
    expect(transport.executeAction).toHaveBeenCalledTimes(2);
  });

  it('preserves a rate-limited action until its retry time', async () => {
    const gateway = await loadedGateway();
    transport.executeAction
      .mockImplementationOnce(async (_credential, body) => {
        const request = JSON.parse(body) as { actionId: string };
        throw new GameApiError(
          429,
          {
            error: 'Wait briefly',
            code: 'RATE_LIMITED',
            actionId: request.actionId,
          },
          2_000,
        );
      })
      .mockImplementationOnce(async (_credential, body) => resultFor(body, 1));

    const action = gateway.execute({ type: 'attack' });
    await vi.waitFor(() =>
      expect(gateway.getSnapshot().lifecycle).toMatchObject({
        kind: 'retry-required',
        retryAt: 2_000,
      }),
    );
    await expect(gateway.retryPendingAction()).rejects.toBeInstanceOf(
      RetryNotReadyError,
    );
    now = 2_000;
    const firstBody = serializedBody(0);
    await gateway.retryPendingAction();
    await action;
    expect(serializedBody(1)).toBe(firstBody);
  });

  it('blocks mismatched action identities without mutating the model', async () => {
    const gateway = await loadedGateway();
    transport.executeAction.mockImplementationOnce(
      async (_credential, body) => ({
        ...resultFor(body, 1),
        actionId: 'another-action',
      }),
    );
    const before = gateway.getModel().getSnapshot();

    void gateway.execute({ type: 'attack' });
    await vi.waitFor(() =>
      expect(gateway.getSnapshot().lifecycle.kind).toBe('retry-required'),
    );

    expect(gateway.getModel().getSnapshot()).toBe(before);
    expect(gateway.getModel().getSnapshot().revision).toBe(0);
  });

  it('accepts a new command after a non-retryable command failure', async () => {
    const gateway = await loadedGateway();
    transport.executeAction
      .mockRejectedValueOnce(
        new GameApiError(409, {
          error: 'Action identity was already used',
          code: 'ACTION_ID_REUSED',
          actionId: 'action-1',
        }),
      )
      .mockImplementationOnce(async (_credential, body) => resultFor(body, 1));

    await expect(gateway.execute({ type: 'attack' })).rejects.toBeInstanceOf(
      GameApiError,
    );
    expect(gateway.getSnapshot().lifecycle.kind).toBe('command-failed');

    await expect(
      gateway.execute({ type: 'move', direction: 'right' }),
    ).resolves.toMatchObject({ revision: 1 });
    expect(gateway.getSnapshot().lifecycle.kind).toBe('playing');
  });

  it('treats a wall collision as a silent no-op and dispatches the queued input', async () => {
    const gateway = await loadedGateway();
    transport.executeAction
      .mockImplementationOnce(async (_credential, body) => {
        const request = JSON.parse(body) as { actionId: string };
        throw new GameApiError(400, {
          error: 'The command is not valid for the current game state',
          code: 'INVALID_COMMAND',
          actionId: request.actionId,
          revision: 0,
          state: visibleState(),
        });
      })
      .mockImplementationOnce(async (_credential, body) => resultFor(body, 1));

    const blocked = gateway.execute({ type: 'move', direction: 'left' });
    const queued = gateway.execute({ type: 'move', direction: 'right' });

    await expect(blocked).rejects.toBeInstanceOf(GameApiError);
    await expect(queued).resolves.toMatchObject({ revision: 1 });
    expect(actionBody(1)).toMatchObject({
      expectedRevision: 0,
      command: { type: 'move', direction: 'right' },
    });
    expect(gateway.getSnapshot().lifecycle.kind).toBe('playing');
  });

  it('clears pending and queued commands for protocol mismatch and terminal success', async () => {
    const mismatchGateway = await loadedGateway();
    const mismatch = deferred<GameCommandResult>();
    transport.executeAction.mockReturnValueOnce(mismatch.promise);
    const pending = mismatchGateway.execute({ type: 'attack' });
    const queued = mismatchGateway.execute({ type: 'move', direction: 'left' });
    mismatch.reject(new GameProtocolMismatchError('0'));

    await expect(pending).rejects.toBeInstanceOf(GameProtocolMismatchError);
    await expect(queued).rejects.toBeInstanceOf(GameProtocolMismatchError);
    expect(mismatchGateway.getSnapshot().lifecycle.kind).toBe(
      'protocol-mismatch',
    );

    transport.loadGame.mockResolvedValue({
      revision: 0,
      state: visibleState(),
    });
    const terminalGateway = createGateway(credential);
    await terminalGateway.loadGame();
    const terminalListener = vi.fn();
    terminalGateway.subscribeTerminal(terminalListener);
    transport.executeAction.mockImplementationOnce(async (_credential, body) =>
      resultFor(body, 1, { status: 'won' }),
    );

    await terminalGateway.execute({ type: 'attack' });
    expect(terminalGateway.getSnapshot().lifecycle).toEqual({
      kind: 'won',
      revision: 1,
    });
    expect(storage.clearActiveGame).toHaveBeenCalled();
    expect(terminalListener).toHaveBeenCalledOnce();
  });

  it('clears invalid restoration but preserves transient restoration failures', async () => {
    transport.loadGame.mockRejectedValueOnce(new GameNetworkError());
    const transient = createGateway(credential);
    await expect(transient.loadGame()).rejects.toBeInstanceOf(GameNetworkError);
    expect(transient.getSnapshot().lifecycle).toEqual({
      kind: 'load-failed',
      message:
        'Could not reach the game server. Your saved game is still available; retry when the server is running.',
    });
    expect(storage.clearActiveGame).not.toHaveBeenCalled();

    transport.loadGame.mockRejectedValueOnce(
      new GameApiError(401, {
        error: 'Expired',
        code: 'UNAUTHORIZED',
      }),
    );
    const invalid = createGateway(credential);
    await expect(invalid.loadGame()).rejects.toBeInstanceOf(GameApiError);
    expect(invalid.getSnapshot().lifecycle.kind).toBe('session-invalid');
    expect(storage.clearActiveGame).toHaveBeenCalledOnce();
  });

  it('explains when creation cannot reach the game server', async () => {
    transport.createGame.mockRejectedValueOnce(new GameNetworkError());
    const gateway = createGateway();

    await expect(
      gateway.createGame({ playerName: 'Ada', character: 'wizard' }),
    ).rejects.toBeInstanceOf(GameNetworkError);
    expect(gateway.getSnapshot().lifecycle).toEqual({
      kind: 'create-failed',
      message:
        'Could not reach the game server. Check that it is running, then try again.',
    });
  });

  it('clears an in-flight action and queued intent when the session is invalidated', async () => {
    const gateway = await loadedGateway();
    const response = deferred<GameCommandResult>();
    transport.executeAction.mockReturnValueOnce(response.promise);
    const pending = gateway.execute({ type: 'attack' });
    const queued = gateway.execute({ type: 'move', direction: 'right' });
    response.reject(
      new GameApiError(401, {
        error: 'Expired',
        code: 'UNAUTHORIZED',
        actionId: 'action-1',
      }),
    );

    await expect(pending).rejects.toBeInstanceOf(GameApiError);
    await expect(queued).rejects.toBeInstanceOf(GameApiError);
    expect(gateway.getSnapshot().lifecycle.kind).toBe('session-invalid');
    expect(storage.clearActiveGame).toHaveBeenCalledOnce();
    await expect(gateway.execute({ type: 'attack' })).rejects.toThrow(
      'not accepting commands',
    );
  });

  it('restores dead and won games to terminal state without singleton leakage', async () => {
    for (const status of ['dead', 'won'] as const) {
      transport.loadGame.mockResolvedValueOnce({
        revision: 9,
        state: visibleState({ revision: 9, status }),
      });
      const gateway = createGateway(credential);
      const result = await gateway.loadGame();
      expect(gateway.getSnapshot().lifecycle).toEqual({
        kind: status,
        revision: 9,
      });
      expect(result.model.getSnapshot().status).toBe(status);
    }

    transport.loadGame.mockResolvedValueOnce({
      revision: 0,
      state: visibleState({ _id: credential.gameId, status: 'active' }),
    });
    const fresh = createGateway(credential);
    await fresh.loadGame();
    expect(fresh.getSnapshot().lifecycle.kind).toBe('playing');
  });

  it('awaits abandon, preserves credentials on failure, and treats missing games as gone', async () => {
    const gateway = await loadedGateway();
    transport.abandonGame.mockRejectedValueOnce(new GameNetworkError());

    await expect(gateway.abandonGame()).rejects.toBeInstanceOf(
      GameNetworkError,
    );
    expect(gateway.getSnapshot().lifecycle.kind).toBe('abandon-failed');
    expect(gateway.getSnapshot().lifecycle).toEqual({
      kind: 'abandon-failed',
      message: 'Could not reach the game server. The game was not abandoned.',
    });
    expect(storage.clearActiveGame).not.toHaveBeenCalled();

    transport.abandonGame.mockResolvedValueOnce();
    await gateway.retryAbandon();
    expect(gateway.getSnapshot().lifecycle.kind).toBe('abandoned');
    expect(storage.clearActiveGame).toHaveBeenCalledOnce();

    transport.loadGame.mockResolvedValueOnce({
      revision: 0,
      state: visibleState(),
    });
    const missing = createGateway(credential);
    await missing.loadGame();
    transport.abandonGame.mockRejectedValueOnce(
      new GameApiError(404, { error: 'Missing', code: 'GAME_NOT_FOUND' }),
    );
    await expect(missing.abandonGame()).resolves.toBeUndefined();
    expect(missing.getSnapshot().lifecycle.kind).toBe('abandoned');
  });

  function createGateway(boundCredential?: typeof credential): GameGateway {
    return new GameGateway({
      transport,
      storage,
      credential: boundCredential,
      actionId: () => `action-${++actionNumber}`,
      now: () => now,
    });
  }

  async function loadedGateway(): Promise<GameGateway> {
    transport.loadGame.mockResolvedValueOnce({
      revision: 0,
      state: visibleState(),
    });
    const gateway = createGateway(credential);
    await gateway.loadGame();
    return gateway;
  }

  function serializedBody(call: number): string {
    return transport.executeAction.mock.calls[call]?.[1] ?? '';
  }

  function actionBody(call: number): Record<string, unknown> {
    return JSON.parse(serializedBody(call)) as Record<string, unknown>;
  }
});

function visibleState(
  overrides?: Parameters<typeof StoreHelpers.visibleGameState>[0],
) {
  return StoreHelpers.visibleGameState({
    _id: credential.gameId,
    ...overrides,
  });
}

function resultFor(
  serializedBody: string,
  revision: number,
  overrides?: Parameters<typeof StoreHelpers.visibleGameState>[0],
): GameCommandResult {
  const request = JSON.parse(serializedBody) as { actionId: string };
  return {
    actionId: request.actionId,
    revision,
    state: visibleState({ revision, ...overrides }),
    events: [],
    deltas: [],
  };
}

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
