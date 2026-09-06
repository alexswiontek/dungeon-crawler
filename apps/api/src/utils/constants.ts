export const MAX_PLAYER_NAME_LENGTH = 20;

export const GAME_TTL_SECONDS = 7 * 24 * 60 * 60;

// A warm game retains roughly 75 KB, so this bounds the cache near 37 MB.
export const WARM_GAME_CACHE_LIMIT = 500;

export const LEADERBOARD_DEFAULT_LIMIT = 10;
export const LEADERBOARD_MAX_LIMIT = 100;

export const RATE_LIMIT_MAX_REQUESTS = 100;
export const GAME_ACTION_RATE_LIMIT_MAX_REQUESTS = 1000;
export const RATE_LIMIT_TIME_WINDOW = '1 minute';

export const PERF_THRESHOLD_MOVE_MS = 50;
export const PERF_THRESHOLD_ATTACK_MS = 50;
export const PERF_THRESHOLD_MESSAGE_MS = 100;
export const PERF_THRESHOLD_PATHFINDING_MS = 10;
