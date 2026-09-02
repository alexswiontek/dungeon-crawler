/**
 * Centralized constants for the game API
 * All magic numbers and configuration values should be defined here
 */

// ============================================================
// API INPUT CONSTANTS
// ============================================================

/**
 * Player Configuration
 */
export const MAX_PLAYER_NAME_LENGTH = 20;

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
export const GAME_ACTION_RATE_LIMIT_MAX_REQUESTS = 1000;
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
