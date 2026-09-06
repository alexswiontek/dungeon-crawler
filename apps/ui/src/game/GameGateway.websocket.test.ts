import {
  GAME_WEBSOCKET_BUFFERED_AMOUNT_LIMIT,
  type GameCommandResult,
  GAMEPLAY_PROTOCOL_VERSION,
  GameWebSocketCloseCode,
} from '@dungeon-crawler/protocol/schemas';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandQueueOverflowError, GameGateway } from '@/game/GameGateway';
import type { GameTransport } from '@/game/GameHttpClient';
import type { ActiveGameStorage } from '@/game/GameSessionStorage';
import { StoreHelpers } from '@/test/helpers/storeHelpers';

const credential = { gameId: 'socket-game', sessionToken: 'private-token' };

class FakeWebSocket extends EventTarget {
  readonly sent: string[] = [];
  readyState: number = WebSocket.CONNECTING;
  bufferedAmount = 0;

  open(): void {
    this.readyState = WebSocket.OPEN;
    this.dispatchEvent(new Event('open'));
  }

  receive(message: unknown): void {
    this.dispatchEvent(
      new MessageEvent('message', { data: JSON.stringify(message) }),
    );
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(code = 1000, reason = ''): void {
    if (this.readyState === WebSocket.CLOSED) return;
    this.readyState = WebSocket.CLOSED;
    this.dispatchEvent(new CloseEvent('close', { code, reason }));
  }
}

describe('GameGateway WebSocket pipeline', () => {
  let sockets: FakeWebSocket[];
  let actionNumber: number;
  let transport: GameTransport;
  let storage: ActiveGameStorage;

  beforeEach(() => {
    sockets = [];
    actionNumber = 0;
    transport = {
      createGame: vi.fn(),
      migrateLegacyGame: vi.fn(),
      loadGame: vi.fn().mockResolvedValue({ revision: 0, state: state(0) }),
      executeAction: vi.fn(),
      abandonGame: vi.fn(),
      openGameSocket: vi.fn(() => {
        const socket = new FakeWebSocket();
        sockets.push(socket);
        return socket as unknown as WebSocket;
      }),
    };
    storage = {
      saveActiveGame: vi.fn().mockReturnValue(true),
      clearActiveGame: vi.fn(),
      clearLegacyGame: vi.fn(),
    };
  });

  afterEach(() => vi.useRealTimers());

  it('authenticates in the first message and pipelines eight inputs immediately', async () => {
    const gateway = await loadedGateway();
    authenticate(sockets[0]);

    const actions = Array.from({ length: 8 }, () =>
      gateway.execute({ type: 'move', direction: 'right' }),
    );

    expect(commandMessages(sockets[0])).toHaveLength(8);
    expect(
      commandMessages(sockets[0]).map((message) => message.expectedRevision),
    ).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    await expect(
      gateway.execute({ type: 'move', direction: 'left' }),
    ).rejects.toBeInstanceOf(CommandQueueOverflowError);
    expect(gateway.getMetrics()).toMatchObject({
      queueDepth: 8,
      peakQueueDepth: 8,
      inFlightCount: 8,
      rejectedInputCount: 1,
    });

    actions.forEach((promise) => void promise.catch(() => {}));
    gateway.dispose();
  });

  it('buffers out-of-order acknowledgments and applies them in revision order', async () => {
    const gateway = await loadedGateway();
    authenticate(sockets[0]);
    const first = gateway.execute({ type: 'move', direction: 'right' });
    const second = gateway.execute({ type: 'move', direction: 'down' });
    const [firstMessage, secondMessage] = commandMessages(sockets[0]);
    if (!firstMessage || !secondMessage)
      throw new Error('Commands were not sent.');

    sockets[0]?.receive(ack(secondMessage.actionId, 2));
    expect(gateway.getModel().getSnapshot().revision).toBe(0);
    sockets[0]?.receive(ack(firstMessage.actionId, 1));

    await expect(first).resolves.toMatchObject({ revision: 1 });
    await expect(second).resolves.toMatchObject({ revision: 2 });
    expect(gateway.getModel().getSnapshot().revision).toBe(2);
  });

  it('ignores a duplicate acknowledgment without regressing later state', async () => {
    const gateway = await loadedGateway();
    authenticate(sockets[0]);
    const first = gateway.execute({ type: 'attack' });
    const second = gateway.execute({ type: 'attack' });
    const [firstMessage, secondMessage] = commandMessages(sockets[0]);
    if (!firstMessage || !secondMessage)
      throw new Error('Commands were not sent.');

    sockets[0]?.receive(ack(firstMessage.actionId, 1));
    await first;
    sockets[0]?.receive(ack(firstMessage.actionId, 1));
    sockets[0]?.receive(ack(secondMessage.actionId, 2));

    await expect(second).resolves.toMatchObject({ revision: 2 });
    expect(gateway.getModel().getSnapshot().revision).toBe(2);
  });

  it('retries an acknowledgment lost after commit with the byte-identical envelope', async () => {
    vi.useFakeTimers();
    const gateway = await loadedGateway();
    authenticate(sockets[0]);
    const action = gateway.execute({ type: 'attack' });
    const original = sockets[0]?.sent[1];
    sockets[0]?.close(1006);

    await vi.advanceTimersByTimeAsync(400);
    const replacement = sockets[1];
    if (!replacement) throw new Error('The replacement socket was not opened.');
    replacement.open();
    replacement.receive(authenticated(1));

    expect(replacement.sent[1]).toBe(original);
    const retried = commandMessages(replacement)[0];
    if (!retried) throw new Error('The command was not retried.');
    replacement.receive(ack(retried.actionId, 1));
    await expect(action).resolves.toMatchObject({ revision: 1 });
    expect(gateway.getMetrics().reconnectCount).toBe(1);
  });

  it('resolves multiple exact retries after reconnect hydration advances state', async () => {
    vi.useFakeTimers();
    const gateway = await loadedGateway();
    authenticate(sockets[0]);
    const first = gateway.execute({ type: 'move', direction: 'right' });
    const second = gateway.execute({ type: 'move', direction: 'down' });
    const originals = sockets[0]?.sent.slice(1);
    sockets[0]?.close(1006);

    await vi.advanceTimersByTimeAsync(400);
    const replacement = sockets[1];
    if (!replacement) throw new Error('The replacement socket was not opened.');
    replacement.open();
    replacement.receive(authenticated(2));

    expect(replacement.sent.slice(1)).toEqual(originals);
    const [firstRetry, secondRetry] = commandMessages(replacement);
    if (!firstRetry || !secondRetry)
      throw new Error('The commands were not retried.');
    replacement.receive(ack(firstRetry.actionId, 2));
    replacement.receive(ack(secondRetry.actionId, 2));

    await expect(first).resolves.toMatchObject({ revision: 2 });
    await expect(second).resolves.toMatchObject({ revision: 2 });
    expect(gateway.getModel().getSnapshot().revision).toBe(2);
  });

  it('rebases later accepted input under a new action ID after a middle rejection', async () => {
    const gateway = await loadedGateway();
    authenticate(sockets[0]);
    const first = gateway.execute({ type: 'move', direction: 'right' });
    const rejected = gateway.execute({ type: 'move', direction: 'left' });
    const later = gateway.execute({ type: 'move', direction: 'down' });
    const original = commandMessages(sockets[0]);
    const rejection = expect(rejected).rejects.toMatchObject({
      response: { code: 'INVALID_COMMAND' },
    });
    const firstMessage = original[0];
    const rejectedMessage = original[1];
    const staleLaterMessage = original[2];
    if (!firstMessage || !rejectedMessage || !staleLaterMessage)
      throw new Error('Commands were not sent.');

    sockets[0]?.receive(ack(firstMessage.actionId, 1));
    sockets[0]?.receive({
      type: 'command_error',
      error: 'Blocked movement',
      code: 'INVALID_COMMAND',
      actionId: rejectedMessage.actionId,
      revision: 1,
      state: state(1),
    });
    await rejection;

    const rebased = commandMessages(sockets[0])[3];
    if (!rebased) throw new Error('The later command was not rebased.');
    expect(rebased).toMatchObject({
      actionId: 'action-4',
      expectedRevision: 1,
      command: { type: 'move', direction: 'down' },
    });
    expect(rebased.actionId).not.toBe(original[2]?.actionId);
    sockets[0]?.receive({
      type: 'command_error',
      error: 'Synchronize and retry',
      code: 'REVISION_CONFLICT',
      actionId: staleLaterMessage.actionId,
      revision: 1,
      state: state(1),
    });
    sockets[0]?.receive(ack(rebased.actionId, 2));

    await expect(first).resolves.toMatchObject({ revision: 1 });
    await expect(later).resolves.toMatchObject({ revision: 2 });
    expect(gateway.getModel().getSnapshot().revision).toBe(2);
  });

  it('ignores callbacks from a stale socket after reconnect', async () => {
    vi.useFakeTimers();
    const gateway = await loadedGateway();
    const original = sockets[0];
    authenticate(original);
    original?.close(1006);
    await vi.advanceTimersByTimeAsync(400);
    const current = sockets[1];
    if (!current) throw new Error('The replacement socket was not opened.');
    current.open();
    current.receive(authenticated(0));

    original?.receive(authenticated(9));
    expect(gateway.getModel().getSnapshot().revision).toBe(0);
    expect(gateway.getSnapshot().transportState).toBe('ready');
  });

  it('preserves unsent accepted input in FIFO order through reconnect', async () => {
    vi.useFakeTimers();
    const gateway = await loadedGateway();
    const original = sockets[0];
    authenticate(original);
    if (!original) throw new Error('The socket was not opened.');
    original.bufferedAmount = GAME_WEBSOCKET_BUFFERED_AMOUNT_LIMIT;
    const first = gateway.execute({ type: 'move', direction: 'right' });
    const second = gateway.execute({ type: 'attack' });
    expect(commandMessages(original)).toHaveLength(0);
    original.close(1006);

    await vi.advanceTimersByTimeAsync(250);
    const replacement = sockets[1];
    if (!replacement) throw new Error('The replacement socket was not opened.');
    replacement.open();
    replacement.receive(authenticated(0));
    const resent = commandMessages(replacement);
    expect(resent.map((message) => message.actionId)).toEqual([
      'action-1',
      'action-2',
    ]);
    replacement.receive(ack(resent[0]?.actionId ?? '', 1));
    replacement.receive(ack(resent[1]?.actionId ?? '', 2));
    await first;
    await second;
  });

  it('honors the server reconnect instruction with bounded backoff', async () => {
    vi.useFakeTimers();
    const gateway = await loadedGateway();
    authenticate(sockets[0]);
    sockets[0]?.receive({
      type: 'reconnect',
      reason: 'server_shutdown',
    });

    expect(gateway.getSnapshot().transportState).toBe('reconnecting');
    expect(gateway.getMetrics().lastTransportErrorCategory).toBe(
      'server_shutdown',
    );
    await vi.advanceTimersByTimeAsync(250);
    expect(sockets).toHaveLength(2);
  });

  it('closes the socket and cancels connection timers during teardown', async () => {
    vi.useFakeTimers();
    const gateway = await loadedGateway();
    const socket = sockets[0];

    gateway.dispose();
    await vi.advanceTimersByTimeAsync(20_000);

    expect(socket?.readyState).toBe(WebSocket.CLOSED);
    expect(sockets).toHaveLength(1);
  });

  it('stops reconnecting after an authentication-failure close', async () => {
    vi.useFakeTimers();
    const gateway = await loadedGateway();
    sockets[0]?.close(GameWebSocketCloseCode.AUTHENTICATION_FAILED);

    expect(gateway.getSnapshot()).toMatchObject({
      transportState: 'terminal-failure',
      lifecycle: { kind: 'session-invalid' },
    });
    expect(storage.clearActiveGame).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(sockets).toHaveLength(1);
  });

  it('falls back to sequential HTTP after four consecutive socket failures', async () => {
    vi.useFakeTimers();
    const executeAction = vi.mocked(transport.executeAction);
    executeAction.mockImplementation(async (_credential, body) => {
      const request = JSON.parse(body) as { actionId: string };
      return {
        actionId: request.actionId,
        revision: 1,
        state: state(1),
        events: [],
        deltas: [],
      };
    });
    const gateway = await loadedGateway();
    authenticate(sockets[0]);
    sockets[0]?.close(1006);
    await vi.advanceTimersByTimeAsync(250);
    sockets[1]?.close(1006);
    await vi.advanceTimersByTimeAsync(500);
    sockets[2]?.close(1006);
    await vi.advanceTimersByTimeAsync(1_000);
    sockets[3]?.close(1006);

    expect(gateway.getSnapshot().transportState).toBe('degraded-http-fallback');
    await expect(gateway.execute({ type: 'attack' })).resolves.toMatchObject({
      revision: 1,
    });
    expect(executeAction).toHaveBeenCalledOnce();
  });

  it('falls back after four sockets authenticate and immediately close', async () => {
    vi.useFakeTimers();
    const gateway = await loadedGateway();

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const socket = sockets[attempt];
      if (!socket) throw new Error('The reconnect socket was not opened.');
      socket.open();
      socket.receive(authenticated(0));
      socket.close(1006);
      if (attempt < 3) {
        await vi.advanceTimersByTimeAsync(250 * 2 ** attempt);
      }
    }

    expect(gateway.getSnapshot().transportState).toBe('degraded-http-fallback');
  });

  async function loadedGateway(): Promise<GameGateway> {
    const gateway = new GameGateway({
      transport,
      storage,
      credential,
      actionId: () => `action-${++actionNumber}`,
      random: () => 0,
    });
    await gateway.loadGame();
    return gateway;
  }
});

function authenticate(socket: FakeWebSocket | undefined): void {
  if (!socket) throw new Error('The socket was not opened.');
  socket.open();
  expect(JSON.parse(socket.sent[0] ?? '')).toEqual({
    type: 'authenticate',
    protocolVersion: GAMEPLAY_PROTOCOL_VERSION,
    sessionToken: credential.sessionToken,
  });
  socket.receive(authenticated(0));
}

function authenticated(revision: number) {
  return {
    type: 'authenticated',
    protocolVersion: GAMEPLAY_PROTOCOL_VERSION,
    revision,
    state: state(revision),
  };
}

function commandMessages(socket: FakeWebSocket | undefined) {
  return (socket?.sent.slice(1) ?? []).map(
    (message) =>
      JSON.parse(message) as {
        actionId: string;
        expectedRevision: number;
        command: unknown;
      },
  );
}

function ack(
  actionId: string,
  revision: number,
): GameCommandResult & {
  type: 'acknowledgment';
} {
  return {
    type: 'acknowledgment',
    actionId,
    revision,
    state: state(revision),
    events: [],
    deltas: [],
  };
}

function state(revision: number) {
  return StoreHelpers.visibleGameState({
    _id: credential.gameId,
    revision,
    player: { x: revision + 2 },
  });
}
