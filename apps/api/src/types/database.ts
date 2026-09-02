/**
 * Database-specific type definitions
 */
import type {
  EnemyType,
  EnemyVariant,
  GameState,
  SeededRandomState,
} from '@dungeon-crawler/domain';
import type { GameCommandResult } from '@dungeon-crawler/protocol';

/** A bounded durable receipt for replaying action metadata without domain work. */
export interface GameActionReceipt {
  actionId: string;
  requestFingerprint: string;
  revision: number;
  events: GameCommandResult['events'];
  deltas: GameCommandResult['deltas'];
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
  schemaVersion: 1;
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

export type LegacyGameDocument = GameState;

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
