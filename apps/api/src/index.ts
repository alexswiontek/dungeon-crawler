import 'dotenv/config';
import { GAMEPLAY_PROTOCOL_HEADER } from '@dungeon-crawler/protocol';
import cors, { type FastifyCorsOptions } from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { gameRoutes } from '@/routes/game.js';
import { leaderboardRoutes } from '@/routes/leaderboard.js';
import {
  closeDatabase,
  connectToDatabase,
  isDatabaseHealthy,
} from '@/services/database.js';
import {
  startLeaderboardReconciliation,
  stopLeaderboardReconciliation,
} from '@/services/gameCommandService.js';
import {
  RATE_LIMIT_MAX_REQUESTS,
  RATE_LIMIT_TIME_WINDOW,
} from '@/utils/constants.js';

const PORT = parseInt(process.env.PORT || '3000', 10);

// Validate PORT - use console.error here since logger isn't initialized yet
if (Number.isNaN(PORT) || PORT < 1 || PORT > 65535) {
  console.error(`Invalid PORT: ${process.env.PORT}. Server cannot start.`);
  process.exit(1);
}

// CORS Configuration - filter out empty strings and whitespace
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
          level: 'warn', // Only log warnings and errors in production
        }
      : {
          level: 'info', // Log everything in development
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

// Set Zod validator and serializer
fastify.setValidatorCompiler(validatorCompiler);
fastify.setSerializerCompiler(serializerCompiler);

await fastify.register(cors, {
  delegator: (req, cb) => {
    const corsOptions: FastifyCorsOptions = {
      exposedHeaders: [GAMEPLAY_PROTOCOL_HEADER],
      maxAge: 86_400,
      origin: (
        origin: string | undefined,
        callback: (err: Error | null, origin: string | boolean) => void,
      ) => {
        // Always allow health check endpoint (needed for Docker healthcheck)
        if (req.url === '/health') {
          return callback(null, true);
        }

        // Allow null origin in development OR when accessing via localhost
        // (localhost Docker setups can have null origins for SSR/static pages)
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

// Security headers
await fastify.register(helmet, {
  contentSecurityPolicy: false, // Let frontend handle CSP if needed
});

// Rate limiting
await fastify.register(rateLimit, {
  global: true,
  max: RATE_LIMIT_MAX_REQUESTS,
  timeWindow: RATE_LIMIT_TIME_WINDOW,
});

// Register routes
await fastify.register(gameRoutes);
await fastify.register(leaderboardRoutes, { prefix: '/leaderboard' });

// Health check
fastify.get('/health', async (_request, reply) => {
  try {
    // Add timeout to health check to prevent hanging
    // Use 4s timeout (shorter than DB's 5s socketTimeoutMS to avoid race)
    const dbHealthyPromise = isDatabaseHealthy();
    const timeoutPromise = new Promise<boolean>((resolve) =>
      setTimeout(() => resolve(false), 4000),
    );
    const dbHealthy = await Promise.race([
      dbHealthyPromise.catch(() => false), // Convert rejections to false
      timeoutPromise,
    ]);

    if (!dbHealthy) {
      return reply.status(503).send({ status: 'error', db: 'disconnected' });
    }
    return { status: 'ok', db: 'connected' };
  } catch (err: unknown) {
    const error = err instanceof Error ? err : new Error(String(err));
    fastify.log.error({ err: error }, 'Health check failed');
    return reply.status(503).send({ status: 'error', db: 'check_failed' });
  }
});

const start = async () => {
  try {
    await connectToDatabase();
    await fastify.listen({ port: PORT, host: '0.0.0.0' });
    fastify.log.info(`Server listening on http://0.0.0.0:${PORT}`);

    startLeaderboardReconciliation();
    fastify.log.info(`CORS enabled for origins: ${ALLOWED_ORIGINS.join(', ')}`);
  } catch (err: unknown) {
    const error = err instanceof Error ? err : new Error(String(err));
    fastify.log.error({ err: error }, 'Failed to start server');
    await closeDatabase();
    await fastify.close().catch(() => {}); // Ignore close errors
    process.exit(1);
  }
};

// Graceful shutdown
const shutdown = async () => {
  stopLeaderboardReconciliation();
  await closeDatabase();
  await fastify.close();
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

start();
