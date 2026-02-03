/**
 * Centralized constants for the game API
 * All magic numbers and configuration values should be defined here
 */

// ============================================================
// GAME BALANCE CONSTANTS
// ============================================================

/**
 * Player Configuration
 */
export const MAX_PLAYER_NAME_LENGTH = 20;

/**
 * Level Up Stats
 */
export const LEVEL_UP_HP_GAIN = 3;
export const LEVEL_UP_ATTACK_GAIN = 1;
export const LEVEL_UP_DEFENSE_GAIN = 1;
export const LEVEL_UP_HEAL_PERCENTAGE = 0.5; // Heal 50% of max HP on level up

/**
 * Floor Progression
 */
export const MAX_FLOOR = 20; // Win condition floor
export const FLOOR_DESCEND_SCORE_BONUS = 100;
export const VICTORY_SCORE_BONUS = 1000;

/**
 * Enemy Scores
 */
import type { EnemyType } from '@dungeon-crawler/shared';

export const ENEMY_SCORES: Record<EnemyType, number> = {
  rat: 10,
  skeleton: 25,
  orc: 50,
  dragon: 200,
};

/**
 * Enemy AI Configuration
 */
export const MAX_PATHFINDING_ENEMIES = 5; // Performance optimization: limit pathfinding per turn
export const FLEE_HP_THRESHOLD = 0.3; // Enemies flee when HP falls below 30%

// ============================================================
// SERVER CONFIGURATION CONSTANTS
// ============================================================

/**
 * WebSocket Configuration
 */
export const MAX_MESSAGE_SIZE = 1024; // 1KB max
export const MAX_PARSE_ERRORS = 5; // Max parse errors before connection closure
export const WS_MESSAGE_QUEUE_SIZE = 5; // Maximum queued messages
export const WS_MESSAGE_QUEUE_OVERFLOW_SIZE = 10; // Close connection if queue exceeds this

/**
 * Session Management
 */
export const SESSION_TIMEOUT = 5 * 60 * 1000; // 5 minutes in milliseconds

/**
 * Database Configuration
 */
export const GAME_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days in seconds

/**
 * Leaderboard Configuration
 */
export const LEADERBOARD_DEFAULT_LIMIT = 10;
export const LEADERBOARD_MAX_LIMIT = 100;

/**
 * Rate Limiting
 */
export const RATE_LIMIT_MAX_REQUESTS = 100;
export const RATE_LIMIT_TIME_WINDOW = '1 minute';

// ============================================================
// PERFORMANCE THRESHOLDS
// ============================================================

/**
 * Performance monitoring thresholds (in milliseconds)
 */
export const PERF_THRESHOLD_MOVE_MS = 50;
export const PERF_THRESHOLD_ATTACK_MS = 50;
export const PERF_THRESHOLD_MESSAGE_MS = 100;
export const PERF_THRESHOLD_PATHFINDING_MS = 10;
