import 'dotenv/config';
import {
  GAME_WEBSOCKET_MESSAGE_SIZE_LIMIT,
  GAMEPLAY_PROTOCOL_HEADER,
} from '@dungeon-crawler/protocol';
import cors, { type FastifyCorsOptions } from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import Fastify from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { gameRoutes } from '@/routes/game.js';
import {
  GameWebSocketHub,
  registerGameWebSocketRoute,
} from '@/routes/gameWebSocket.js';
import { leaderboardRoutes } from '@/routes/leaderboard.js';
import {
  closeDatabase,
  connectToDatabase,
  isDatabaseHealthy,
} from '@/services/database.js';
import {
  flushGameCheckpoints,
  startLeaderboardReconciliation,
  stopLeaderboardReconciliation,
} from '@/services/gameCommandService.js';
import {
  closeRedis,
  connectToRedis,
  isRedisHealthy,
} from '@/services/redis.js';
import {
  RATE_LIMIT_MAX_REQUESTS,
  RATE_LIMIT_TIME_WINDOW,
} from '@/utils/constants.js';

const PORT = parseInt(process.env.PORT || '3000', 10);

// Fastify's logger is not initialized yet.
if (Number.isNaN(PORT) || PORT < 1 || PORT > 65535) {
  console.error(`Invalid PORT: ${process.env.PORT}. Server cannot start.`);
  process.exit(1);
}

const ALLOWED_ORIGINS = (
  process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:5173']
)
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0);

const fastify = Fastify({
  trustProxy: true,
  logger:
    process.env.NODE_ENV === 'production'
      ? {
          level: 'info',
        }
      : {
          level: 'info',
          transport: {
            target: 'pino-pretty',
            options: {
              colorize: true,
              translateTime: 'HH:MM:ss',
              ignore: 'pid,hostname',
              errorLikeObjectKeys: ['err', 'error'],
            },
          },
        },
}).withTypeProvider<ZodTypeProvider>();

fastify.setValidatorCompiler(validatorCompiler);
fastify.setSerializerCompiler(serializerCompiler);

await fastify.register(websocket, {
  options: { maxPayload: GAME_WEBSOCKET_MESSAGE_SIZE_LIMIT * 8 },
});

await fastify.register(cors, {
  delegator: (req, cb) => {
    const corsOptions: FastifyCorsOptions = {
      exposedHeaders: [GAMEPLAY_PROTOCOL_HEADER],
      maxAge: 86_400,
      origin: (
        origin: string | undefined,
        callback: (err: Error | null, origin: string | boolean) => void,
      ) => {
        // Docker health checks may not send an Origin header.
        if (req.url.startsWith('/health')) {
          return callback(null, true);
        }

        // Local Docker and development requests may have no Origin header.
        const isLocalhost =
          req.headers.host?.includes('localhost') ||
          req.headers.host?.includes('127.0.0.1');
        const allowNullOrigin =
          process.env.NODE_ENV !== 'production' || isLocalhost;

        if (
          (allowNullOrigin && !origin) ||
          (origin && ALLOWED_ORIGINS.includes(origin))
        ) {
          return callback(null, true);
        }

        fastify.log.warn(
          { origin: origin || 'null', host: req.headers.host },
          'CORS rejected origin',
        );
        return callback(new Error('Not allowed by CORS'), false);
      },
    };
    cb(null, corsOptions);
  },
});

await fastify.register(helmet, {
  contentSecurityPolicy: false,
});

await fastify.register(rateLimit, {
  global: true,
  max: RATE_LIMIT_MAX_REQUESTS,
  timeWindow: RATE_LIMIT_TIME_WINDOW,
});

const gameWebSocketHub = new GameWebSocketHub(fastify);
registerGameWebSocketRoute(fastify, gameWebSocketHub);
await fastify.register(gameRoutes);
await fastify.register(leaderboardRoutes, { prefix: '/leaderboard' });

fastify.get('/health', async () => ({ status: 'ok' }));

fastify.get('/health/dependencies', async (_request, reply) => {
  try {
    const dependencyChecks = Promise.all([
      isDatabaseHealthy().catch(() => false),
      isRedisHealthy().catch(() => false),
    ]);
    const timeout = new Promise<[boolean, boolean]>((resolve) =>
      setTimeout(() => resolve([false, false]), 4_000),
    );
    const [mongodb, redis] = await Promise.race([dependencyChecks, timeout]);
    if (!mongodb || !redis) {
      return reply.status(503).send({
        status: 'error',
        mongodb: mongodb ? 'connected' : 'disconnected',
        redis: redis ? 'connected' : 'disconnected',
      });
    }
    return { status: 'ok', mongodb: 'connected', redis: 'connected' };
  } catch (err: unknown) {
    const error = err instanceof Error ? err : new Error(String(err));
    fastify.log.error({ err: error }, 'Health check failed');
    return reply.status(503).send({
      status: 'error',
      mongodb: 'check_failed',
      redis: 'check_failed',
    });
  }
});

const start = async () => {
  try {
    await connectToDatabase();
    await connectToRedis();
    await fastify.listen({ port: PORT, host: '0.0.0.0' });
    fastify.log.info(`Server listening on http://0.0.0.0:${PORT}`);

    startLeaderboardReconciliation();
    fastify.log.info(`CORS enabled for origins: ${ALLOWED_ORIGINS.join(', ')}`);
  } catch (err: unknown) {
    const error = err instanceof Error ? err : new Error(String(err));
    fastify.log.error({ err: error }, 'Failed to start server');
    await closeDatabase();
    await closeRedis();
    await fastify.close().catch(() => {});
    process.exit(1);
  }
};

const shutdown = async () => {
  stopLeaderboardReconciliation();
  await gameWebSocketHub.shutdown();
  await flushGameCheckpoints();
  await fastify.close();
  await closeRedis();
  await closeDatabase();
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

start();
