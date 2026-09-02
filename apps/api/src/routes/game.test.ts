import {
  GAMEPLAY_PROTOCOL_HEADER,
  GAMEPLAY_PROTOCOL_VERSION,
  GameCommandResultSchema,
  GameErrorResponseSchema,
  GameStateResponseSchema,
  NewGameResponseSchema,
  projectGameState,
} from '@dungeon-crawler/protocol';
import rateLimit from '@fastify/rate-limit';
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
import { createTestGameState } from '@/test/helpers/gameStateHelpers.js';
import { GameServiceError } from '@/types/gameServiceErrors.js';
import { GAME_ACTION_RATE_LIMIT_MAX_REQUESTS } from '@/utils/constants.js';
import { gameRoutes } from './game.js';

vi.mock('@/services/database.js', () => ({
  isDatabaseHealthy: vi.fn(),
}));

vi.mock('@/services/gameCommandService.js', () => ({
  createGameSession: vi.fn(),
  migrateLegacyGame: vi.fn(),
  readGame: vi.fn(),
  executeGameCommand: vi.fn(),
  deleteGame: vi.fn(),
}));

const TOKEN = 'route-session-token';
const game = createTestGameState({ _id: 'route-game' });
const state = projectGameState(game, 0);

describe('canonical HTTP game routes', () => {
  let fastify: FastifyInstance;

  beforeAll(async () => {
    fastify = Fastify().withTypeProvider<ZodTypeProvider>();
    fastify.addHook('onRequest', async (request) => {
      request.headers[GAMEPLAY_PROTOCOL_HEADER] ??= GAMEPLAY_PROTOCOL_VERSION;
    });
    fastify.setValidatorCompiler(validatorCompiler);
    fastify.setSerializerCompiler(serializerCompiler);
    await fastify.register(gameRoutes);
  });

  afterAll(async () => {
    await fastify.close();
  });

  beforeEach(() => {
    vi.mocked(database.isDatabaseHealthy).mockResolvedValue(true);
    vi.mocked(commands.createGameSession).mockResolvedValue({
      gameId: 'route-game',
      sessionToken: TOKEN,
      revision: 0,
      state,
    });
    vi.mocked(commands.migrateLegacyGame).mockResolvedValue({
      gameId: 'route-game',
      sessionToken: TOKEN,
      revision: 0,
      state,
    });
    vi.mocked(commands.readGame).mockResolvedValue({ revision: 0, state });
    vi.mocked(commands.executeGameCommand).mockImplementation(
      async (request) => {
        const revision = request.expectedRevision + 1;
        return {
          actionId: request.actionId,
          revision,
          state: { ...state, revision },
          events: [],
          deltas: [],
        };
      },
    );
    vi.mocked(commands.deleteGame).mockResolvedValue();
  });

  it('creates a game with 201 and returns the one-time token in a strict filtered response', async () => {
    const response = await fastify.inject({
      method: 'POST',
      url: '/games',
      payload: { playerName: '  Ada  ', character: 'wizard' },
    });

    expect(response.statusCode).toBe(201);
    expect(response.headers[GAMEPLAY_PROTOCOL_HEADER]).toBe(
      GAMEPLAY_PROTOCOL_VERSION,
    );
    expect(NewGameResponseSchema.parse(response.json())).toMatchObject({
      gameId: 'route-game',
      sessionToken: TOKEN,
      revision: 0,
    });
    expect(response.json().state).not.toHaveProperty('map');
    expect(response.json().state).not.toHaveProperty('sessionTokenHash');
    expect(response.json().state).not.toHaveProperty('random');
    expect(commands.createGameSession).toHaveBeenCalledOnce();
    expect(commands.createGameSession).toHaveBeenCalledWith({
      playerName: 'Ada',
      character: 'wizard',
    });
  });

  it('migrates a legacy game through a one-time pre-authentication route', async () => {
    const response = await fastify.inject({
      method: 'POST',
      url: '/games/route-game/migrate',
    });

    expect(response.statusCode).toBe(200);
    expect(NewGameResponseSchema.parse(response.json())).toMatchObject({
      gameId: 'route-game',
      sessionToken: TOKEN,
      revision: 0,
    });
    expect(commands.migrateLegacyGame).toHaveBeenCalledWith('route-game');
  });

  it('rejects a missing protocol version before creating or migrating a game', async () => {
    const app = Fastify().withTypeProvider<ZodTypeProvider>();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    await app.register(gameRoutes);
    vi.mocked(commands.createGameSession).mockClear();
    vi.mocked(commands.migrateLegacyGame).mockClear();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/games',
        payload: { playerName: 'Ada', character: 'wizard' },
      });

      expect(response.statusCode).toBe(409);
      expect(response.headers[GAMEPLAY_PROTOCOL_HEADER]).toBe(
        GAMEPLAY_PROTOCOL_VERSION,
      );
      expect(GameErrorResponseSchema.parse(response.json())).toMatchObject({
        code: 'PROTOCOL_MISMATCH',
      });
      expect(commands.createGameSession).not.toHaveBeenCalled();
      expect(commands.migrateLegacyGame).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('reads with 200, bearer authentication, and no repeated credential', async () => {
    const response = await fastify.inject({
      method: 'GET',
      url: '/games/route-game',
      headers: { authorization: `Bearer ${TOKEN}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers[GAMEPLAY_PROTOCOL_HEADER]).toBe(
      GAMEPLAY_PROTOCOL_VERSION,
    );
    expect(GameStateResponseSchema.parse(response.json())).toEqual({
      revision: 0,
      state,
    });
    expect(response.body).not.toContain(TOKEN);
    expect(commands.readGame).toHaveBeenCalledWith('route-game', TOKEN);
  });

  it.each([
    ['movement', { type: 'move', direction: 'right' }],
    ['ranged attack', { type: 'attack' }],
    ['floor descent', { type: 'descend' }],
  ] as const)(
    'routes %s through executeGameCommand exactly once with all five concepts',
    async (_name, command) => {
      const response = await fastify.inject({
        method: 'POST',
        url: '/games/route-game/actions',
        headers: { authorization: `Bearer ${TOKEN}` },
        payload: {
          actionId: 'action-1',
          expectedRevision: 4,
          command,
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers[GAMEPLAY_PROTOCOL_HEADER]).toBe(
        GAMEPLAY_PROTOCOL_VERSION,
      );
      expect(GameCommandResultSchema.parse(response.json()).revision).toBe(5);
      expect(commands.executeGameCommand).toHaveBeenCalledOnce();
      expect(commands.executeGameCommand).toHaveBeenCalledWith({
        gameId: 'route-game',
        sessionToken: TOKEN,
        actionId: 'action-1',
        expectedRevision: 4,
        command,
      });
    },
  );

  it('deletes with bearer authentication and an empty 204 response', async () => {
    const response = await fastify.inject({
      method: 'DELETE',
      url: '/games/route-game',
      headers: { authorization: `Bearer ${TOKEN}` },
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers[GAMEPLAY_PROTOCOL_HEADER]).toBe(
      GAMEPLAY_PROTOCOL_VERSION,
    );
    expect(response.body).toBe('');
    expect(commands.deleteGame).toHaveBeenCalledWith('route-game', TOKEN);
  });

  it('rejects missing credentials before protected services are called', async () => {
    const responses = await Promise.all([
      fastify.inject({ method: 'GET', url: '/games/route-game' }),
      fastify.inject({
        method: 'POST',
        url: '/games/route-game/actions',
        payload: {
          actionId: 'action-1',
          expectedRevision: 0,
          command: { type: 'attack' },
        },
      }),
      fastify.inject({ method: 'DELETE', url: '/games/route-game' }),
    ]);

    for (const response of responses) {
      expect(response.statusCode).toBe(401);
      expect(response.headers[GAMEPLAY_PROTOCOL_HEADER]).toBe(
        GAMEPLAY_PROTOCOL_VERSION,
      );
      expect(GameErrorResponseSchema.parse(response.json()).code).toBe(
        'UNAUTHORIZED',
      );
    }
    expect(commands.readGame).not.toHaveBeenCalled();
    expect(commands.executeGameCommand).not.toHaveBeenCalled();
    expect(commands.deleteGame).not.toHaveBeenCalled();
  });

  it('maps wrong bearer credentials to 401 for read, action, and delete', async () => {
    const unauthorized = new GameServiceError(
      'UNAUTHORIZED',
      'Invalid game credentials',
    );
    vi.mocked(commands.readGame).mockRejectedValueOnce(unauthorized);
    vi.mocked(commands.executeGameCommand).mockRejectedValueOnce(unauthorized);
    vi.mocked(commands.deleteGame).mockRejectedValueOnce(unauthorized);
    const headers = { authorization: 'Bearer wrong-token' };
    const responses = await Promise.all([
      fastify.inject({ method: 'GET', url: '/games/route-game', headers }),
      fastify.inject({
        method: 'POST',
        url: '/games/route-game/actions',
        headers,
        payload: {
          actionId: 'action-1',
          expectedRevision: 0,
          command: { type: 'attack' },
        },
      }),
      fastify.inject({ method: 'DELETE', url: '/games/route-game', headers }),
    ]);

    for (const response of responses) {
      expect(response.statusCode).toBe(401);
      expect(GameErrorResponseSchema.parse(response.json()).code).toBe(
        'UNAUTHORIZED',
      );
      expect(response.body).not.toContain('wrong-token');
    }
  });

  it.each([
    {},
    { actionId: '', expectedRevision: 0, command: { type: 'attack' } },
    {
      actionId: 'x'.repeat(129),
      expectedRevision: 0,
      command: { type: 'attack' },
    },
    { actionId: 'action-1', expectedRevision: -1, command: { type: 'attack' } },
    {
      actionId: 'action-1',
      expectedRevision: 0.5,
      command: { type: 'attack' },
    },
    {
      actionId: 'action-1',
      expectedRevision: 0,
      command: { type: 'move', direction: 'diagonal' },
    },
    {
      actionId: 'action-1',
      expectedRevision: 0,
      command: { type: 'teleport' },
    },
    {
      actionId: 'action-1',
      expectedRevision: 0,
      command: { type: 'attack' },
      sessionToken: TOKEN,
    },
  ])(
    'rejects an invalid action body without calling the service',
    async (payload) => {
      const response = await fastify.inject({
        method: 'POST',
        url: '/games/route-game/actions',
        headers: { authorization: `Bearer ${TOKEN}` },
        payload,
      });

      expect(response.statusCode).toBe(400);
      expect(GameErrorResponseSchema.parse(response.json()).code).toBe(
        'INVALID_COMMAND',
      );
      expect(commands.executeGameCommand).not.toHaveBeenCalled();
    },
  );

  it('returns a typed conflict with safe synchronization state', async () => {
    vi.mocked(commands.executeGameCommand).mockRejectedValueOnce(
      new GameServiceError('REVISION_CONFLICT', 'Synchronize first', {
        actionId: 'stale-action',
        revision: 7,
        state: { ...state, revision: 7 },
      }),
    );
    const response = await fastify.inject({
      method: 'POST',
      url: '/games/route-game/actions',
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: {
        actionId: 'stale-action',
        expectedRevision: 6,
        command: { type: 'attack' },
      },
    });

    expect(response.statusCode).toBe(409);
    expect(GameErrorResponseSchema.parse(response.json())).toMatchObject({
      code: 'REVISION_CONFLICT',
      actionId: 'stale-action',
      revision: 7,
      state: { revision: 7 },
    });
    expect(response.json().state).not.toHaveProperty('map');
    expect(response.json()).not.toHaveProperty('stack');
    expect(response.body).not.toContain(TOKEN);
  });

  it.each([
    ['GAME_NOT_FOUND', 404],
    ['INVALID_COMMAND', 400],
    ['ACTION_ID_REUSED', 409],
    ['GAME_FINISHED', 409],
    ['RATE_LIMITED', 429],
    ['DATABASE_UNAVAILABLE', 503],
    ['DATABASE_ERROR', 503],
  ] as const)(
    'maps %s to %s with a schema-valid safe body',
    async (code, status) => {
      vi.mocked(commands.executeGameCommand).mockRejectedValueOnce(
        new GameServiceError(code, 'Safe failure'),
      );
      const response = await fastify.inject({
        method: 'POST',
        url: '/games/route-game/actions',
        headers: { authorization: `Bearer ${TOKEN}` },
        payload: {
          actionId: 'action-1',
          expectedRevision: 0,
          command: { type: 'attack' },
        },
      });

      expect(response.statusCode).toBe(status);
      expect(GameErrorResponseSchema.parse(response.json())).toMatchObject({
        code,
        error: 'Safe failure',
      });
      expect(response.json()).not.toHaveProperty('stack');
    },
  );

  it('does not retain the obsolete game routes', async () => {
    const responses = await Promise.all([
      fastify.inject({ method: 'POST', url: '/game/new' }),
      fastify.inject({ method: 'GET', url: '/game/route-game' }),
      fastify.inject({ method: 'POST', url: '/game/route-game/move' }),
      fastify.inject({ method: 'POST', url: '/game/route-game/descend' }),
      fastify.inject({ method: 'GET', url: '/game/route-game/ws' }),
    ]);
    for (const response of responses) expect(response.statusCode).toBe(404);
  });

  it('allows sustained action traffic above the global request ceiling', async () => {
    const limitedApp = await createRateLimitedTestApp(100);
    try {
      const responses = await Promise.all(
        Array.from({ length: 101 }, (_, index) =>
          limitedApp.inject({
            method: 'POST',
            url: '/games/route-game/actions',
            headers: { authorization: `Bearer ${TOKEN}` },
            payload: {
              actionId: `sustained-action-${index}`,
              expectedRevision: index,
              command: { type: 'move', direction: 'right' },
            },
          }),
        ),
      );

      expect(responses.every((response) => response.statusCode === 200)).toBe(
        true,
      );
      expect(responses.at(-1)?.headers['x-ratelimit-limit']).toBe(
        String(GAME_ACTION_RATE_LIMIT_MAX_REQUESTS),
      );
      expect(commands.executeGameCommand).toHaveBeenCalledTimes(101);
    } finally {
      await limitedApp.close();
    }
  });

  it('preserves typed 429 responses and retry timing', async () => {
    const limitedApp = await createRateLimitedTestApp(2);
    try {
      const responses = [];
      for (let index = 0; index < 3; index++) {
        responses.push(
          await limitedApp.inject({
            method: 'GET',
            url: '/games/route-game',
            headers: { authorization: `Bearer ${TOKEN}` },
          }),
        );
      }
      const limited = responses.find((response) => response.statusCode === 429);

      expect(responses.map((response) => response.statusCode).sort()).toEqual([
        200, 200, 429,
      ]);
      expect(limited).toBeDefined();
      expect(limited?.headers['retry-after']).toBeDefined();
      expect(limited?.headers[GAMEPLAY_PROTOCOL_HEADER]).toBe(
        GAMEPLAY_PROTOCOL_VERSION,
      );
      expect(GameErrorResponseSchema.parse(limited?.json())).toMatchObject({
        code: 'RATE_LIMITED',
      });
      expect(limited?.body).not.toContain('Rate limit exceeded');
    } finally {
      await limitedApp.close();
    }
  });

  it('rate-limits forwarded clients independently behind one trusted proxy', async () => {
    const app = Fastify({
      trustProxy: true,
    }).withTypeProvider<ZodTypeProvider>();
    app.addHook('onRequest', async (request) => {
      request.headers[GAMEPLAY_PROTOCOL_HEADER] ??= GAMEPLAY_PROTOCOL_VERSION;
    });
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    await app.register(rateLimit, {
      global: true,
      max: 1,
      timeWindow: '1 minute',
    });
    await app.register(gameRoutes);
    try {
      const first = await app.inject({
        method: 'GET',
        url: '/games/route-game',
        headers: {
          authorization: `Bearer ${TOKEN}`,
          'x-forwarded-for': '198.51.100.1',
        },
      });
      const second = await app.inject({
        method: 'GET',
        url: '/games/route-game',
        headers: {
          authorization: `Bearer ${TOKEN}`,
          'x-forwarded-for': '198.51.100.2',
        },
      });

      expect([first.statusCode, second.statusCode]).toEqual([200, 200]);
    } finally {
      await app.close();
    }
  });
});

async function createRateLimitedTestApp(max: number): Promise<FastifyInstance> {
  const app = Fastify().withTypeProvider<ZodTypeProvider>();
  app.addHook('onRequest', async (request) => {
    request.headers[GAMEPLAY_PROTOCOL_HEADER] ??= GAMEPLAY_PROTOCOL_VERSION;
  });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(rateLimit, { global: true, max, timeWindow: '1 minute' });
  await app.register(gameRoutes);
  return app;
}
