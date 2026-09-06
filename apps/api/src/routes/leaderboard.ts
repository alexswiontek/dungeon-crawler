import type { LeaderboardEntry } from '@dungeon-crawler/domain/model';
import type { FastifyInstance } from 'fastify';
import { getDb } from '@/services/database.js';
import { createErrorResponse, ErrorCode } from '@/types/apiErrors.js';
import {
  LEADERBOARD_DEFAULT_LIMIT,
  LEADERBOARD_MAX_LIMIT,
} from '@/utils/constants.js';

export async function leaderboardRoutes(
  fastify: FastifyInstance,
): Promise<void> {
  const leaderboard = () => getDb().collection<LeaderboardEntry>('leaderboard');

  // Get top scores
  fastify.get<{ Querystring: { limit?: string } }>(
    '/',
    async (
      request,
      reply,
    ): Promise<{ entries: LeaderboardEntry[] } | undefined> => {
      try {
        const limitInput =
          request.query.limit || String(LEADERBOARD_DEFAULT_LIMIT);
        const parsedLimit = parseInt(limitInput, 10);

        if (Number.isNaN(parsedLimit) || parsedLimit < 1) {
          return reply
            .status(400)
            .send(
              createErrorResponse(
                'Invalid limit parameter',
                ErrorCode.INVALID_LIMIT,
              ),
            );
        }

        const limit = Math.min(parsedLimit, LEADERBOARD_MAX_LIMIT);

        const entries = await leaderboard()
          .find()
          .sort({ score: -1 })
          .limit(limit)
          .toArray();

        return { entries };
      } catch (err: unknown) {
        const error = err instanceof Error ? err : new Error(String(err));
        fastify.log.error({ err: error }, 'Failed to fetch leaderboard');
        return reply
          .status(500)
          .send(
            createErrorResponse(
              'Failed to fetch leaderboard',
              ErrorCode.DATABASE_ERROR,
            ),
          );
      }
    },
  );

  // Get recent scores
  fastify.get(
    '/recent',
    async (
      _request,
      reply,
    ): Promise<{ entries: LeaderboardEntry[] } | undefined> => {
      try {
        const entries = await leaderboard()
          .find()
          .sort({ createdAt: -1 })
          .limit(LEADERBOARD_DEFAULT_LIMIT)
          .toArray();

        return { entries };
      } catch (err: unknown) {
        const error = err instanceof Error ? err : new Error(String(err));
        fastify.log.error({ err: error }, 'Failed to fetch recent scores');
        return reply
          .status(500)
          .send(
            createErrorResponse(
              'Failed to fetch recent scores',
              ErrorCode.DATABASE_ERROR,
            ),
          );
      }
    },
  );
}
