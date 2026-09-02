/**
 * Database-specific type definitions
 */
import type {
  EnemyType,
  EnemyVariant,
  GameCommand,
  GameState,
  SeededRandomState,
} from '@dungeon-crawler/domain';
import type { GameCommandResult } from '@dungeon-crawler/protocol';

/**
 * A bounded durable receipt. The full original filtered result is retained so
 * an accepted retry can be answered without re-running domain code or RNG.
 */
export interface GameActionReceipt {
  actionId: string;
  requestFingerprint: string;
  expectedRevision: number;
  command: GameCommand;
  result: GameCommandResult;
  recordedAt: Date;
}

export type LeaderboardDelivery =
  | { status: 'none' }
  | {
      status: 'pending' | 'submitted';
      outcome: {
        playerName: string;
        score: number;
        floor: number;
        killedBy: string | null;
        killedByType: EnemyType | null;
        killedByVariant: EnemyVariant | null;
        finishedAt: Date;
      };
    };

/**
 * MongoDB persistence envelope. Domain state, wire projection, and persistence
 * metadata intentionally remain separate types.
 */
export interface StoredGameDocument {
  _id: string;
  sessionTokenHash: string;
  revision: number;
  random: {
    seed: string;
    state: SeededRandomState;
  };
  game: GameState;
  actionReceipts: GameActionReceipt[];
  leaderboard: LeaderboardDelivery;
  updatedAt: Date;
}

/**
 * Leaderboard entry document structure in MongoDB
 */
export interface LeaderboardDoc {
  _id: string;
  playerName: string;
  score: number;
  floor: number;
  killedBy: string | null;
  killedByType: EnemyType | null;
  killedByVariant: EnemyVariant | null;
  createdAt: Date;
}
