import type { LeaderboardEntry } from '@dungeon-crawler/shared';
import type { FastifyInstance } from 'fastify';
import { getDb } from '@/services/database.js';

export async function leaderboardRoutes(fastify: FastifyInstance) {
  const leaderboard = () => getDb().collection<LeaderboardEntry>('leaderboard');

  // Get top scores
  fastify.get<{ Querystring: { limit?: string } }>('/', async (request) => {
    const limit = parseInt(request.query.limit || '10', 10);

    const entries = await leaderboard()
      .find()
      .sort({ score: -1 })
      .limit(Math.min(limit, 100))
      .toArray();

    return { entries };
  });

  // Get recent scores
  fastify.get('/recent', async () => {
    const entries = await leaderboard()
      .find()
      .sort({ createdAt: -1 })
      .limit(10)
      .toArray();

    return { entries };
  });
}
