import { projectGameState } from '@dungeon-crawler/protocol/client-projection';
import {
  type GameCommandResult,
  GAMEPLAY_PROTOCOL_VERSION,
  GameWebSocketCloseCode,
  GameWebSocketServerMessageSchema,
} from '@dungeon-crawler/protocol/schemas';
import websocket from '@fastify/websocket';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import {
  GameWebSocketHub,
  registerGameWebSocketRoute,
} from '@/routes/gameWebSocket.js';
import { createTestGameState } from '@/test/helpers/gameStateHelpers.js';
import { GameServiceError } from '@/types/gameServiceErrors.js';

const networkIt =
  process.env.RUN_WEBSOCKET_NETWORK_INTEGRATION === '1' ? it : it.skip;

describe('game WebSocket route', () => {
  let app: ReturnType<typeof Fastify>;
  let executeGameCommand: ReturnType<typeof vi.fn>;
  let readGame: ReturnType<typeof vi.fn>;
  let hub: GameWebSocketHub;

  beforeEach(async () => {
    vi.useRealTimers();
    app = Fastify({ logger: false });
    await app.register(websocket);
    readGame = vi.fn(async (gameId: string, token: string) => {
      if (token !== 'valid-token') {
        throw new GameServiceError('UNAUTHORIZED', 'Invalid game credentials');
      }
      return { revision: 0, state: visibleState(gameId, 0) };
    });
    executeGameCommand = vi.fn(
      async (request: {
        gameId: string;
        actionId: string;
        expectedRevision: number;
      }) =>
        result(request.gameId, request.actionId, request.expectedRevision + 1),
    );
    hub = new GameWebSocketHub(
      app,
      {
        readGame: readGame as never,
        executeGameCommand: executeGameCommand as never,
      },
      { authenticationTimeoutMs: 20, shutdownDrainTimeoutMs: 20 },
    );
    registerGameWebSocketRoute(app, hub);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    vi.useRealTimers();
  });

  it('requires authentication as the first application message', async () => {
    const socket = await app.injectWS('/games/game-1/stream');
    const close = nextClose(socket);
    const message = nextMessage(socket);
    socket.send(command('action-1', 0));

    await expect(message).resolves.toMatchObject({
      type: 'command_error',
      code: 'UNAUTHORIZED',
      actionId: 'action-1',
    });
    await expect(close).resolves.toBe(
      GameWebSocketCloseCode.COMMAND_BEFORE_AUTHENTICATION,
    );
    expect(executeGameCommand).not.toHaveBeenCalled();
  });

  it('closes an idle unauthenticated socket after the fixed timeout', async () => {
    const socket = await app.injectWS('/games/game-1/stream');
    const close = nextClose(socket);

    await expect(close).resolves.toBe(
      GameWebSocketCloseCode.AUTHENTICATION_TIMEOUT,
    );
  });

  it('rejects invalid credentials without replacing a valid owner', async () => {
    const owner = await app.injectWS('/games/game-1/stream');
    await authenticate(owner);
    const failed = await app.injectWS('/games/game-1/stream');
    const failedClose = nextClose(failed);
    failed.send(authentication('wrong-token'));
    await expect(failedClose).resolves.toBe(
      GameWebSocketCloseCode.AUTHENTICATION_FAILED,
    );

    const acknowledgment = nextMessage(owner);
    owner.send(command('action-1', 0));
    await expect(acknowledgment).resolves.toMatchObject({
      type: 'acknowledgment',
      actionId: 'action-1',
    });
    expect(executeGameCommand).toHaveBeenCalledOnce();
  });

  it('replaces the prior owner only after successful authentication', async () => {
    const owner = await app.injectWS('/games/game-1/stream');
    await authenticate(owner);
    const replaced = nextClose(owner);
    const replacement = await app.injectWS('/games/game-1/stream');
    await authenticate(replacement);

    await expect(replaced).resolves.toBe(
      GameWebSocketCloseCode.CONNECTION_REPLACED,
    );
  });

  it('processes pipelined commands sequentially for one game', async () => {
    const first = deferred<GameCommandResult>();
    executeGameCommand
      .mockReturnValueOnce(first.promise)
      .mockImplementationOnce(async (request) =>
        result(request.gameId, request.actionId, 2),
      );
    const socket = await app.injectWS('/games/game-1/stream');
    await authenticate(socket);
    const messages = collectMessages(socket, 2);
    socket.send(command('action-1', 0));
    socket.send(command('action-2', 1));

    await vi.waitFor(() => expect(executeGameCommand).toHaveBeenCalledOnce());
    first.resolve(result('game-1', 'action-1', 1));
    await expect(messages).resolves.toMatchObject([
      {
        type: 'acknowledgment',
        actionId: 'action-1',
        revision: 1,
        serverPeakQueueDepth: 2,
      },
      {
        type: 'acknowledgment',
        actionId: 'action-2',
        revision: 2,
        serverPeakQueueDepth: 2,
      },
    ]);
  });

  networkIt(
    'upgrades a real local connection and accepts pipelined commands',
    async () => {
      const address = await app.listen({ host: '127.0.0.1', port: 0 });
      const socket = new WebSocket(
        `${address.replace(/^http/, 'ws')}/games/game-1/stream`,
      );
      await new Promise<void>((resolve, reject) => {
        socket.once('open', resolve);
        socket.once('error', reject);
      });
      await authenticate(socket);
      const messages = collectMessages(socket, 2);
      socket.send(command('action-1', 0));
      socket.send(command('action-2', 1));

      await expect(messages).resolves.toMatchObject([
        { type: 'acknowledgment', actionId: 'action-1', revision: 1 },
        { type: 'acknowledgment', actionId: 'action-2', revision: 2 },
      ]);
      socket.close();
    },
  );

  it('resolves an acknowledgment lost after commit through the retained receipt', async () => {
    const receipts = new Map<string, GameCommandResult>();
    let committedRevision = 0;
    readGame.mockImplementation(async (gameId: string) => ({
      revision: committedRevision,
      state: visibleState(gameId, committedRevision),
    }));
    executeGameCommand.mockImplementation(async (request) => {
      const retained = receipts.get(request.actionId);
      if (retained) return retained;
      committedRevision += 1;
      const committed = result(
        request.gameId,
        request.actionId,
        committedRevision,
      );
      receipts.set(request.actionId, committed);
      return committed;
    });
    const original = await app.injectWS('/games/game-1/stream');
    await authenticate(original);
    original.send(command('stable-action', 0));
    await vi.waitFor(() => expect(executeGameCommand).toHaveBeenCalledOnce());
    original.close();

    const replacement = await app.injectWS('/games/game-1/stream');
    await authenticate(replacement);
    const acknowledgment = nextMessage(replacement);
    replacement.send(command('stable-action', 0));

    await expect(acknowledgment).resolves.toMatchObject({
      type: 'acknowledgment',
      actionId: 'stable-action',
      revision: 1,
    });
    expect(committedRevision).toBe(1);
  });

  it('continues the FIFO after a rejected middle command', async () => {
    executeGameCommand.mockImplementation(async (request) => {
      if (request.actionId === 'action-2') {
        throw new GameServiceError('INVALID_COMMAND', 'Blocked movement', {
          actionId: request.actionId,
          revision: 1,
          state: visibleState(request.gameId, 1),
        });
      }
      if (request.actionId === 'action-3') {
        throw new GameServiceError(
          'REVISION_CONFLICT',
          'Synchronize and retry',
          {
            actionId: request.actionId,
            revision: 1,
            state: visibleState(request.gameId, 1),
          },
        );
      }
      return result(request.gameId, request.actionId, 1);
    });
    const socket = await app.injectWS('/games/game-1/stream');
    await authenticate(socket);
    const messages = collectMessages(socket, 3);
    socket.send(command('action-1', 0));
    socket.send(command('action-2', 1));
    socket.send(command('action-3', 2));

    await expect(messages).resolves.toMatchObject([
      { type: 'acknowledgment', actionId: 'action-1' },
      { type: 'command_error', code: 'INVALID_COMMAND', actionId: 'action-2' },
      {
        type: 'command_error',
        code: 'REVISION_CONFLICT',
        actionId: 'action-3',
      },
    ]);
    expect(executeGameCommand).toHaveBeenCalledTimes(3);
  });

  it('returns a typed service error without a false acknowledgment', async () => {
    executeGameCommand.mockRejectedValueOnce(
      new GameServiceError('SERVICE_UNAVAILABLE', 'Redis is unavailable'),
    );
    const socket = await app.injectWS('/games/game-1/stream');
    await authenticate(socket);
    const message = nextMessage(socket);
    socket.send(command('action-1', 0));

    await expect(message).resolves.toMatchObject({
      type: 'command_error',
      code: 'SERVICE_UNAVAILABLE',
      actionId: 'action-1',
    });
  });

  it('lets different games progress independently', async () => {
    const blocked = deferred<GameCommandResult>();
    executeGameCommand.mockImplementation(async (request) => {
      if (request.gameId === 'game-1') return blocked.promise;
      return result(request.gameId, request.actionId, 1);
    });
    const first = await app.injectWS('/games/game-1/stream');
    const second = await app.injectWS('/games/game-2/stream');
    await authenticate(first);
    await authenticate(second);
    first.send(command('action-1', 0));
    const secondResult = nextMessage(second);
    second.send(command('action-2', 0));

    await expect(secondResult).resolves.toMatchObject({
      type: 'acknowledgment',
      actionId: 'action-2',
    });
    blocked.resolve(result('game-1', 'action-1', 1));
  });

  it('closes malformed JSON with a typed error and deliberate code', async () => {
    const socket = await app.injectWS('/games/game-1/stream');
    const message = nextMessage(socket);
    const close = nextClose(socket);
    socket.send('{not-json');

    await expect(message).resolves.toMatchObject({
      type: 'command_error',
      code: 'MALFORMED_MESSAGE',
    });
    await expect(close).resolves.toBe(GameWebSocketCloseCode.MALFORMED_MESSAGE);
  });

  it('closes an oversized message with a typed error and deliberate code', async () => {
    const socket = await app.injectWS('/games/game-1/stream');
    const message = nextMessage(socket);
    const close = nextClose(socket);
    socket.send('x'.repeat(8_193));

    await expect(message).resolves.toMatchObject({
      type: 'command_error',
      code: 'MALFORMED_MESSAGE',
    });
    await expect(close).resolves.toBe(GameWebSocketCloseCode.MESSAGE_TOO_LARGE);
  });

  it('rejects repeated authentication with a typed error and close code', async () => {
    const socket = await app.injectWS('/games/game-1/stream');
    await authenticate(socket);
    const message = nextMessage(socket);
    const close = nextClose(socket);
    socket.send(authentication());

    await expect(message).resolves.toMatchObject({
      type: 'command_error',
      code: 'MALFORMED_MESSAGE',
    });
    await expect(close).resolves.toBe(
      GameWebSocketCloseCode.REPEATED_AUTHENTICATION,
    );
  });

  it('closes an incompatible protocol before authentication', async () => {
    const socket = await app.injectWS('/games/game-1/stream');
    const message = nextMessage(socket);
    const close = nextClose(socket);
    socket.send(
      JSON.stringify({
        type: 'authenticate',
        protocolVersion: '1',
        sessionToken: 'valid-token',
      }),
    );

    await expect(message).resolves.toMatchObject({
      type: 'protocol_mismatch',
      protocolVersion: GAMEPLAY_PROTOCOL_VERSION,
    });
    await expect(close).resolves.toBe(GameWebSocketCloseCode.PROTOCOL_MISMATCH);
    expect(readGame).not.toHaveBeenCalled();
  });

  it('bounds the server queue and rejects the newest command visibly', async () => {
    const blocked = deferred<GameCommandResult>();
    executeGameCommand.mockReturnValueOnce(blocked.promise);
    const socket = await app.injectWS('/games/game-1/stream');
    await authenticate(socket);
    const overflow = nextMessage(socket);
    const close = nextClose(socket);
    for (let index = 0; index < 17; index += 1) {
      socket.send(command(`action-${index}`, index));
    }

    await expect(overflow).resolves.toMatchObject({
      type: 'command_error',
      code: 'TRANSPORT_OVERFLOW',
      actionId: 'action-16',
    });
    await expect(close).resolves.toBe(GameWebSocketCloseCode.QUEUE_OVERFLOW);
    blocked.resolve(result('game-1', 'action-0', 1));
  });

  it('sends a reconnect instruction and deliberate close during shutdown', async () => {
    const socket = await app.injectWS('/games/game-1/stream');
    await authenticate(socket);
    const message = nextMessage(socket);
    const close = nextClose(socket);

    await hub.shutdown();

    await expect(message).resolves.toEqual({
      type: 'reconnect',
      reason: 'server_shutdown',
    });
    await expect(close).resolves.toBe(GameWebSocketCloseCode.SERVER_SHUTDOWN);
  });

  it('rejects queued commands deterministically before shutdown closes', async () => {
    const blocked = deferred<GameCommandResult>();
    executeGameCommand.mockReturnValueOnce(blocked.promise);
    const socket = await app.injectWS('/games/game-1/stream');
    await authenticate(socket);
    const messages = collectMessages(socket, 2);
    const close = nextClose(socket);
    socket.send(command('action-1', 0));
    socket.send(command('action-2', 1));
    await vi.waitFor(() => expect(executeGameCommand).toHaveBeenCalledOnce());

    await hub.shutdown();

    await expect(messages).resolves.toMatchObject([
      {
        type: 'command_error',
        code: 'SERVICE_UNAVAILABLE',
        actionId: 'action-2',
      },
      { type: 'reconnect', reason: 'server_shutdown' },
    ]);
    await expect(close).resolves.toBe(GameWebSocketCloseCode.SERVER_SHUTDOWN);
    blocked.resolve(result('game-1', 'action-1', 1));
  });
});

function authentication(token = 'valid-token'): string {
  return JSON.stringify({
    type: 'authenticate',
    protocolVersion: GAMEPLAY_PROTOCOL_VERSION,
    sessionToken: token,
  });
}

function command(actionId: string, expectedRevision: number): string {
  return JSON.stringify({
    type: 'command',
    actionId,
    expectedRevision,
    command: { type: 'move', direction: 'right' },
  });
}

async function authenticate(socket: WebSocket): Promise<void> {
  const message = nextMessage(socket);
  socket.send(authentication());
  await expect(message).resolves.toMatchObject({
    type: 'authenticated',
    protocolVersion: GAMEPLAY_PROTOCOL_VERSION,
  });
}

function nextMessage(socket: WebSocket): Promise<unknown> {
  return new Promise((resolve) => {
    socket.once('message', (data) => {
      resolve(
        GameWebSocketServerMessageSchema.parse(JSON.parse(data.toString())),
      );
    });
  });
}

function collectMessages(socket: WebSocket, count: number): Promise<unknown[]> {
  return new Promise((resolve) => {
    const messages: unknown[] = [];
    const listener = (data: Buffer) => {
      messages.push(
        GameWebSocketServerMessageSchema.parse(JSON.parse(data.toString())),
      );
      if (messages.length !== count) return;
      socket.off('message', listener);
      resolve(messages);
    };
    socket.on('message', listener);
  });
}

function nextClose(socket: WebSocket): Promise<number> {
  return new Promise((resolve) => {
    socket.once('close', (code) => resolve(code));
  });
}

function visibleState(gameId: string, revision: number) {
  return projectGameState(createTestGameState({ _id: gameId }), revision);
}

function result(
  gameId: string,
  actionId: string,
  revision: number,
): GameCommandResult {
  return {
    actionId,
    revision,
    state: visibleState(gameId, revision),
    events: [],
    deltas: [],
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
