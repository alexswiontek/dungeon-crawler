/**
 * Database-specific type definitions
 */
import type {
  EnemyType,
  EnemyVariant,
  GameState,
} from '@dungeon-crawler/shared';

/**
 * Game document structure in MongoDB
 * Extends GameState with MongoDB's _id field
 */
export interface GameDoc extends Omit<GameState, '_id'> {
  _id: string;
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

/**
 * WebSocket interface for game sessions
 * Minimal interface matching what we need from ws package
 */
export interface GameWebSocket {
  readyState: number;
  send(data: string): void;
  close(): void;
}
