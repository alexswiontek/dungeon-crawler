/**
 * Leaderboard service for submitting death and victory scores
 * Eliminates 5x duplication of leaderboard insertion logic
 */
import type {
  EnemyType,
  EnemyVariant,
  GameEvent,
} from '@dungeon-crawler/shared';
import { isPlayerDiedEvent } from '@dungeon-crawler/shared';
import type { FastifyBaseLogger } from 'fastify';
import { getDb } from '@/services/database.js';
import { logAndThrow, logError } from '@/utils/errorHandler.js';

/**
 * Submit a death score to the leaderboard
 *
 * @param playerName - Name of the player
 * @param score - Final score achieved
 * @param floor - Floor reached before death
 * @param deathContext - Information about what killed the player
 * @param logger - Optional logger for error reporting
 * @throws Error if database operation fails
 */
export async function submitDeathScore(
  playerName: string,
  score: number,
  floor: number,
  deathContext: {
    killedBy: string;
    killedByType: EnemyType;
    killedByVariant: EnemyVariant;
  },
  logger: FastifyBaseLogger | Console = console,
): Promise<void> {
  // Input validation
  if (!playerName || playerName.trim().length === 0) {
    throw new Error('Player name is required');
  }
  if (score < 0) {
    throw new Error('Score cannot be negative');
  }
  if (floor < 1) {
    throw new Error('Floor must be at least 1');
  }

  const leaderboard = getDb().collection('leaderboard');

  const entry = {
    playerName,
    score,
    floor,
    killedBy: deathContext.killedBy,
    killedByType: deathContext.killedByType,
    killedByVariant: deathContext.killedByVariant,
    createdAt: new Date(),
  };

  try {
    await leaderboard.insertOne(entry);
  } catch (err: unknown) {
    logAndThrow(
      err,
      logger,
      `Database insertOne failed: submitting death score for ${playerName}`,
    );
  }
}

/**
 * Submit a victory score to the leaderboard
 *
 * @param playerName - Name of the player
 * @param score - Final score achieved
 * @param floor - Final floor reached (should be MAX_FLOOR for victories)
 * @param logger - Optional logger for error reporting
 * @throws Error if database operation fails
 */
export async function submitVictoryScore(
  playerName: string,
  score: number,
  floor: number,
  logger: FastifyBaseLogger | Console = console,
): Promise<void> {
  // Input validation
  if (!playerName || playerName.trim().length === 0) {
    throw new Error('Player name is required');
  }
  if (score < 0) {
    throw new Error('Score cannot be negative');
  }
  if (floor < 1) {
    throw new Error('Floor must be at least 1');
  }

  const leaderboard = getDb().collection('leaderboard');

  const entry = {
    playerName,
    score,
    floor,
    killedBy: null,
    killedByType: null,
    killedByVariant: null,
    createdAt: new Date(),
  };

  try {
    await leaderboard.insertOne(entry);
  } catch (err: unknown) {
    logAndThrow(
      err,
      logger,
      `Database insertOne failed: submitting victory score for ${playerName}`,
    );
  }
}

/**
 * Helper function to safely submit death score with error handling
 * Prevents leaderboard failures from crashing game flow
 */
export async function safeSubmitDeathScore(
  playerName: string,
  score: number,
  floor: number,
  events: GameEvent[],
  logger: FastifyBaseLogger | Console,
  gameId: string,
): Promise<void> {
  // Use the proper type guard from shared package
  const killedByEvent = events.find(isPlayerDiedEvent);

  if (!killedByEvent) {
    logError(
      new Error('Player died but no player_died event found'),
      logger,
      'CRITICAL: Player died but no player_died event found',
      { gameId },
    );
    return; // Don't crash, just skip leaderboard submission
  }

  // TypeScript now knows killedByEvent.data is PlayerDiedEventData
  const { killedBy, killedByType, killedByVariant } = killedByEvent.data;

  try {
    await submitDeathScore(
      playerName,
      score,
      floor,
      { killedBy, killedByType, killedByVariant },
      logger,
    );
  } catch (err: unknown) {
    logError(err, logger, `Failed to submit death score for game ${gameId}`, {
      gameId,
    });
    // Don't throw - leaderboard failure shouldn't crash the game
  }
}

/**
 * Helper function to safely submit victory score with error handling
 */
export async function safeSubmitVictoryScore(
  playerName: string,
  score: number,
  floor: number,
  logger: FastifyBaseLogger | Console,
  gameId: string,
): Promise<void> {
  try {
    await submitVictoryScore(playerName, score, floor, logger);
  } catch (err: unknown) {
    logError(err, logger, `Failed to submit victory score for game ${gameId}`, {
      gameId,
    });
    // Don't throw - leaderboard failure shouldn't crash the game
  }
}
