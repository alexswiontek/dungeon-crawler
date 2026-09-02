import { projectGameState } from '@dungeon-crawler/protocol';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import * as database from '@/services/database.js';
import * as commands from '@/services/gameCommandService.js';
import { cleanupAllSessions } from '@/services/gameSessionManager.js';
import { createTestGameState } from '@/test/helpers/gameStateHelpers.js';
import { GameServiceError } from '@/types/gameServiceErrors.js';
import { createMessageProcessor, gameRoutes } from './game.js';

vi.mock('@/services/database.js', () => ({
  isDatabaseHealthy: vi.fn(),
}));

vi.mock('@/services/gameCommandService.js', () => ({
  createGameSession: vi.fn(),
  readGame: vi.fn(),
  executeGameCommand: vi.fn(),
  deleteGame: vi.fn(),
}));

const TOKEN = 'route-session-token';
const game = createTestGameState({ _id: 'route-game' });
const state = projectGameState(game, 0);
const commandResult = {
  actionId: 'action-1',
  revision: 1,
  state: { ...state, revision: 1 },
  events: [],
  deltas: [],
};

describe('Phase 2 game routes', () => {
  let fastify: FastifyInstance;

  beforeAll(async () => {
    fastify = Fastify().withTypeProvider<ZodTypeProvider>();
    fastify.setValidatorCompiler(validatorCompiler);
    fastify.setSerializerCompiler(serializerCompiler);
    await fastify.register(websocket);
    await fastify.register(gameRoutes, { prefix: '/game' });
  });

  afterAll(async () => {
    await fastify.close();
  });

  beforeEach(async () => {
    await cleanupAllSessions();
    vi.mocked(database.isDatabaseHealthy).mockResolvedValue(true);
    vi.mocked(commands.createGameSession).mockResolvedValue({
      gameId: 'route-game',
      sessionToken: TOKEN,
      revision: 0,
      state,
    });
    vi.mocked(commands.readGame).mockResolvedValue({ revision: 0, state });
    vi.mocked(commands.executeGameCommand).mockResolvedValue(commandResult);
    vi.mocked(commands.deleteGame).mockResolvedValue();
  });

  it('returns a token only from create and a filtered projection', async () => {
    const response = await fastify.inject({
      method: 'POST',
      url: '/game/new',
      payload: { playerName: 'Ada', character: 'wizard' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      gameId: 'route-game',
      sessionToken: TOKEN,
      revision: 0,
      state: { revision: 0 },
    });
    expect(response.json().state).not.toHaveProperty('map');
    expect(response.json().state).not.toHaveProperty('sessionTokenHash');
  });

  it('rejects missing credentials for read, command, and deletion', async () => {
    const [read, move, descend, deletion] = await Promise.all([
      fastify.inject({ method: 'GET', url: '/game/route-game' }),
      fastify.inject({
        method: 'POST',
        url: '/game/route-game/move',
        payload: {
          direction: 'left',
          actionId: 'action-1',
          expectedRevision: 0,
        },
      }),
      fastify.inject({
        method: 'POST',
        url: '/game/route-game/descend',
        payload: { actionId: 'action-1', expectedRevision: 0 },
      }),
      fastify.inject({ method: 'DELETE', url: '/game/route-game' }),
    ]);
    for (const response of [read, move, descend, deletion]) {
      expect(response.statusCode).toBe(401);
      expect(response.json().code).toBe('UNAUTHORIZED');
    }
    expect(commands.readGame).not.toHaveBeenCalled();
    expect(commands.executeGameCommand).not.toHaveBeenCalled();
    expect(commands.deleteGame).not.toHaveBeenCalled();
  });

  it('passes bearer credentials and all command concepts to the one service', async () => {
    const headers = { authorization: `Bearer ${TOKEN}` };
    const read = await fastify.inject({
      method: 'GET',
      url: '/game/route-game',
      headers,
    });
    expect(read.statusCode).toBe(200);
    expect(read.json()).not.toHaveProperty('sessionToken');
    expect(commands.readGame).toHaveBeenCalledWith('route-game', TOKEN);

    await fastify.inject({
      method: 'POST',
      url: '/game/route-game/move',
      headers,
      payload: {
        direction: 'right',
        actionId: 'move-action',
        expectedRevision: 3,
      },
    });
    expect(commands.executeGameCommand).toHaveBeenCalledWith({
      gameId: 'route-game',
      sessionToken: TOKEN,
      actionId: 'move-action',
      expectedRevision: 3,
      command: { type: 'move', direction: 'right' },
    });

    await fastify.inject({
      method: 'POST',
      url: '/game/route-game/descend',
      headers,
      payload: { actionId: 'descend-action', expectedRevision: 4 },
    });
    expect(commands.executeGameCommand).toHaveBeenCalledWith({
      gameId: 'route-game',
      sessionToken: TOKEN,
      actionId: 'descend-action',
      expectedRevision: 4,
      command: { type: 'descend' },
    });

    await fastify.inject({
      method: 'DELETE',
      url: '/game/route-game',
      headers,
    });
    expect(commands.deleteGame).toHaveBeenCalledWith('route-game', TOKEN);
  });

  it('maps typed conflicts without exposing internal details', async () => {
    vi.mocked(commands.executeGameCommand).mockRejectedValueOnce(
      new GameServiceError('REVISION_CONFLICT', 'Synchronize first', {
        actionId: 'stale-action',
        revision: 7,
        state: { ...state, revision: 7 },
      }),
    );
    const response = await fastify.inject({
      method: 'POST',
      url: '/game/route-game/move',
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: {
        direction: 'left',
        actionId: 'stale-action',
        expectedRevision: 6,
      },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      code: 'REVISION_CONFLICT',
      revision: 7,
      state: { revision: 7 },
    });
    expect(response.body).not.toContain(TOKEN);
    expect(response.json()).not.toHaveProperty('stack');
  });

  it('authenticates WebSockets by first message before returning state', async () => {
    const socket = new FakeSocket();
    const processor = createMessageProcessor(
      'route-game',
      socket as unknown as WebSocket,
      fastify,
    );
    expect(commands.readGame).not.toHaveBeenCalled();

    processor.enqueueMessage(
      JSON.stringify({ type: 'authenticate', sessionToken: TOKEN }),
    );
    await vi.waitFor(() => expect(socket.sent).toHaveLength(1));
    const init = JSON.parse(socket.sent[0]);
    expect(init).toMatchObject({ type: 'init', revision: 0 });
    expect(commands.readGame).toHaveBeenCalledWith('route-game', TOKEN);

    processor.enqueueMessage(
      JSON.stringify({
        type: 'command',
        actionId: 'ws-action',
        expectedRevision: 0,
        command: { type: 'attack' },
      }),
    );
    await vi.waitFor(() => expect(socket.sent).toHaveLength(2));
    const update = JSON.parse(socket.sent[1]);
    expect(update).toMatchObject({ type: 'update', result: { revision: 1 } });
    expect(commands.executeGameCommand).toHaveBeenCalledWith({
      gameId: 'route-game',
      sessionToken: TOKEN,
      actionId: 'ws-action',
      expectedRevision: 0,
      command: { type: 'attack' },
    });
  });

  it('rejects a WebSocket command sent before authentication without leaking state', async () => {
    const socket = new FakeSocket();
    const processor = createMessageProcessor(
      'route-game',
      socket as unknown as WebSocket,
      fastify,
    );
    processor.enqueueMessage(
      JSON.stringify({
        type: 'command',
        actionId: 'early-action',
        expectedRevision: 0,
        command: { type: 'attack' },
      }),
    );
    await vi.waitFor(() => expect(socket.sent).toHaveLength(1));
    const error = JSON.parse(socket.sent[0]);
    expect(error).toMatchObject({ type: 'error', code: 'UNAUTHORIZED' });
    expect(error).not.toHaveProperty('state');
    expect(commands.readGame).not.toHaveBeenCalled();
    expect(commands.executeGameCommand).not.toHaveBeenCalled();
    expect(socket.close).toHaveBeenCalledOnce();
  });
});

class FakeSocket {
  readonly readyState = 1;
  readonly sent: string[] = [];
  readonly close = vi.fn();

  send(data: string): void {
    this.sent.push(data);
  }
}
