import type { CharacterType } from '@dungeon-crawler/domain';
import {
  GAMEPLAY_PROTOCOL_HEADER,
  GAMEPLAY_PROTOCOL_VERSION,
  type GameActionRequest,
  GameActionRequestSchema,
  GameCommandResultSchema,
  type GameErrorResponse,
  GameErrorResponseSchema,
  GameStateResponseSchema,
  type NewGameRequest,
  NewGameRequestSchema,
  NewGameResponseSchema,
} from '@dungeon-crawler/protocol';
import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  englishDataset,
  englishRecommendedTransformers,
  RegExpMatcher,
} from 'obscenity';
import { isDatabaseHealthy } from '@/services/database.js';
import {
  createGameSession,
  deleteGame,
  executeGameCommand,
  migrateLegacyGame,
  readGame,
} from '@/services/gameCommandService.js';
import { isGameServiceError } from '@/types/gameServiceErrors.js';
import {
  GAME_ACTION_RATE_LIMIT_MAX_REQUESTS,
  MAX_PLAYER_NAME_LENGTH,
  RATE_LIMIT_TIME_WINDOW,
} from '@/utils/constants.js';

const profanityMatcher = new RegExpMatcher({
  ...englishDataset.build(),
  ...englishRecommendedTransformers,
});

const gameErrorResponses = {
  400: GameErrorResponseSchema,
  401: GameErrorResponseSchema,
  404: GameErrorResponseSchema,
  409: GameErrorResponseSchema,
  429: GameErrorResponseSchema,
  503: GameErrorResponseSchema,
};

function sanitizePlayerName(name: string): {
  valid: boolean;
  name: string;
  error?: string;
} {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return { valid: false, name: '', error: 'Name is required' };
  }
  if (trimmed.length > MAX_PLAYER_NAME_LENGTH) {
    return {
      valid: false,
      name: '',
      error: `Name must be ${MAX_PLAYER_NAME_LENGTH} characters or less`,
    };
  }
  if (profanityMatcher.hasMatch(trimmed)) {
    return { valid: false, name: '', error: 'Please choose a different name' };
  }
  return { valid: true, name: trimmed };
}

function bearerToken(authorization: string | undefined): string | undefined {
  return authorization?.match(/^Bearer ([^\s]+)$/i)?.[1];
}

function statusForError(code: GameErrorResponse['code']): number {
  switch (code) {
    case 'UNAUTHORIZED':
      return 401;
    case 'GAME_NOT_FOUND':
      return 404;
    case 'INVALID_COMMAND':
    case 'INVALID_PLAYER_NAME':
      return 400;
    case 'REVISION_CONFLICT':
    case 'ACTION_ID_REUSED':
    case 'GAME_FINISHED':
    case 'PROTOCOL_MISMATCH':
      return 409;
    case 'RATE_LIMITED':
      return 429;
    case 'DATABASE_UNAVAILABLE':
    case 'DATABASE_ERROR':
      return 503;
  }
}

function isRateLimitError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'statusCode' in error &&
    error.statusCode === 429
  );
}

function safeError(error: unknown, actionId?: string): GameErrorResponse {
  if (isGameServiceError(error)) {
    return GameErrorResponseSchema.parse({
      error: error.message,
      code: error.code,
      ...(error.safeContext?.actionId || actionId
        ? { actionId: error.safeContext?.actionId ?? actionId }
        : {}),
      ...(error.safeContext?.revision !== undefined
        ? { revision: error.safeContext.revision }
        : {}),
      ...(error.safeContext?.state ? { state: error.safeContext.state } : {}),
    });
  }
  return GameErrorResponseSchema.parse({
    error: 'The game service is temporarily unavailable',
    code: 'DATABASE_ERROR',
    ...(actionId ? { actionId } : {}),
  });
}

function missingCredentials(): GameErrorResponse {
  return GameErrorResponseSchema.parse({
    error: 'Game credentials are required',
    code: 'UNAUTHORIZED',
  });
}

function sendHttpError(reply: FastifyReply, error: unknown, actionId?: string) {
  const response = safeError(error, actionId);
  return reply.status(statusForError(response.code)).send(response);
}

export async function gameRoutes(fastify: FastifyInstance) {
  fastify.addHook('onRequest', async (request, reply) => {
    const version = request.headers[GAMEPLAY_PROTOCOL_HEADER];
    if (version === GAMEPLAY_PROTOCOL_VERSION) return;
    return reply.status(409).send(
      GameErrorResponseSchema.parse({
        error: 'This client is incompatible with the game server',
        code: 'PROTOCOL_MISMATCH',
      }),
    );
  });

  fastify.addHook('onSend', async (_request, reply) => {
    reply.header(GAMEPLAY_PROTOCOL_HEADER, GAMEPLAY_PROTOCOL_VERSION);
  });

  fastify.setErrorHandler((error, request, reply) => {
    if (isRateLimitError(error)) {
      return reply.status(429).send(
        GameErrorResponseSchema.parse({
          error: 'Too many requests. Wait briefly and try again.',
          code: 'RATE_LIMITED',
        }),
      );
    }
    if (
      typeof error === 'object' &&
      error !== null &&
      'validation' in error &&
      error.validation
    ) {
      return reply.status(400).send(
        GameErrorResponseSchema.parse({
          error: 'Invalid request',
          code: 'INVALID_COMMAND',
        }),
      );
    }
    fastify.log.error(
      {
        err: error,
        method: request.method,
        route: request.routeOptions.url,
      },
      'Unhandled game route error',
    );
    return reply.status(503).send(
      GameErrorResponseSchema.parse({
        error: 'The game service is temporarily unavailable',
        code: 'DATABASE_ERROR',
      }),
    );
  });

  fastify.post<{ Body: NewGameRequest }>(
    '/games',
    {
      schema: {
        body: NewGameRequestSchema,
        response: { 201: NewGameResponseSchema, ...gameErrorResponses },
      },
    },
    async (request, reply) => {
      if (!(await isDatabaseHealthy())) {
        return reply.status(503).send(
          GameErrorResponseSchema.parse({
            error: 'Database unavailable. Please try again later.',
            code: 'DATABASE_UNAVAILABLE',
          }),
        );
      }
      const sanitized = sanitizePlayerName(request.body.playerName);
      if (!sanitized.valid) {
        return reply.status(400).send(
          GameErrorResponseSchema.parse({
            error: sanitized.error ?? 'Invalid player name',
            code: 'INVALID_PLAYER_NAME',
          }),
        );
      }
      try {
        const response = await createGameSession({
          playerName: sanitized.name,
          character: request.body.character as CharacterType,
        });
        return reply.status(201).send(response);
      } catch (error) {
        return sendHttpError(reply, error);
      }
    },
  );

  fastify.post<{ Params: { gameId: string } }>(
    '/games/:gameId/migrate',
    {
      schema: {
        response: { 200: NewGameResponseSchema, ...gameErrorResponses },
      },
    },
    async (request, reply) => {
      if (!(await isDatabaseHealthy())) {
        return reply.status(503).send(
          GameErrorResponseSchema.parse({
            error: 'Database unavailable. Please try again later.',
            code: 'DATABASE_UNAVAILABLE',
          }),
        );
      }
      try {
        const response = await migrateLegacyGame(request.params.gameId);
        return reply.status(200).send(response);
      } catch (error) {
        return sendHttpError(reply, error);
      }
    },
  );

  fastify.get<{ Params: { gameId: string } }>(
    '/games/:gameId',
    {
      schema: {
        response: { 200: GameStateResponseSchema, ...gameErrorResponses },
      },
    },
    async (request, reply) => {
      const token = bearerToken(request.headers.authorization);
      if (!token) return reply.status(401).send(missingCredentials());
      try {
        const response = await readGame(request.params.gameId, token);
        return reply.status(200).send(response);
      } catch (error) {
        return sendHttpError(reply, error);
      }
    },
  );

  fastify.post<{
    Params: { gameId: string };
    Body: GameActionRequest;
  }>(
    '/games/:gameId/actions',
    {
      config: {
        rateLimit: {
          max: GAME_ACTION_RATE_LIMIT_MAX_REQUESTS,
          timeWindow: RATE_LIMIT_TIME_WINDOW,
        },
      },
      schema: {
        body: GameActionRequestSchema,
        response: { 200: GameCommandResultSchema, ...gameErrorResponses },
      },
    },
    async (request, reply) => {
      const token = bearerToken(request.headers.authorization);
      if (!token) return reply.status(401).send(missingCredentials());
      try {
        const response = await executeGameCommand({
          gameId: request.params.gameId,
          sessionToken: token,
          actionId: request.body.actionId,
          expectedRevision: request.body.expectedRevision,
          command: request.body.command,
        });
        return reply.status(200).send(response);
      } catch (error) {
        return sendHttpError(reply, error, request.body.actionId);
      }
    },
  );

  fastify.delete<{ Params: { gameId: string } }>(
    '/games/:gameId',
    { schema: { response: gameErrorResponses } },
    async (request, reply) => {
      const token = bearerToken(request.headers.authorization);
      if (!token) return reply.status(401).send(missingCredentials());
      try {
        await deleteGame(request.params.gameId, token);
        return reply.status(204).send();
      } catch (error) {
        return sendHttpError(reply, error);
      }
    },
  );
}
