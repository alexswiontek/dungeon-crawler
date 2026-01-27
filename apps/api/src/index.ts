import 'dotenv/config';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import Fastify from 'fastify';
import { gameRoutes } from '@/routes/game.js';
import { leaderboardRoutes } from '@/routes/leaderboard.js';
import {
  closeDatabase,
  connectToDatabase,
  isDatabaseHealthy,
} from '@/services/database.js';

const PORT = parseInt(process.env.PORT || '3000', 10);

// CORS Configuration
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS?.split(',') || [
  'http://localhost:5173',
];

const fastify = Fastify({
  logger: true,
});

await fastify.register(cors, {
  origin: (origin, cb) => {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin || ALLOWED_ORIGINS.includes(origin)) {
      return cb(null, true);
    }
    return cb(new Error('Not allowed by CORS'), false);
  },
});

// Security headers
await fastify.register(helmet, {
  contentSecurityPolicy: false, // Let frontend handle CSP if needed
});

// Rate limiting
await fastify.register(rateLimit, {
  global: true,
  max: 100, // 100 requests
  timeWindow: '1 minute',
});

await fastify.register(websocket);

// Register routes
fastify.register(gameRoutes, { prefix: '/game' });
fastify.register(leaderboardRoutes, { prefix: '/leaderboard' });

// Health check
fastify.get('/health', async (_request, reply) => {
  const dbHealthy = await isDatabaseHealthy();
  if (!dbHealthy) {
    return reply.status(503).send({ status: 'error', db: 'disconnected' });
  }
  return { status: 'ok', db: 'connected' };
});

const start = async () => {
  try {
    await connectToDatabase();
    await fastify.listen({ port: PORT, host: '0.0.0.0' });
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

// Graceful shutdown
const shutdown = async () => {
  await closeDatabase();
  await fastify.close();
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

start();
