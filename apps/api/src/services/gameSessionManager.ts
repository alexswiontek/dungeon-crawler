import type { GameState } from '@dungeon-crawler/shared';
import { getDb, isDatabaseHealthy } from '@/services/database.js';
import type { GameDoc, GameWebSocket } from '@/types/database.js';
import { SESSION_TIMEOUT } from '@/utils/constants.js';
import { logger } from '@/utils/logger.js';

interface GameSession {
  gameId: string;
  socket: GameWebSocket;
  isPaused: boolean;
  lastActivity: number;
  gameState: GameState; // In-memory cache of game state
}

// Store active game sessions
const activeSessions = new Map<string, GameSession>();

// In-memory game state cache for active games
// This is the source of truth during active play
// Only written to DB on checkpoints (level descend, death, disconnect)
const gameStateCache = new Map<string, GameState>();

// Cleanup inactive sessions timeout (imported from constants)
// Paused sessions get a longer timeout (30 minutes vs 5 minutes)
const PAUSED_SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes

/**
 * Register a new game session for real-time updates
 * Loads game state from DB into memory cache
 */
export function registerSession(
  gameId: string,
  socket: GameWebSocket,
  initialState: GameState,
): void {
  // Clean up existing session if any (don't save to DB, just clear memory)
  if (activeSessions.has(gameId)) {
    logger.info({ gameId }, 'Replacing existing session');
    activeSessions.delete(gameId);
  }

  const session: GameSession = {
    gameId,
    socket,
    isPaused: false,
    lastActivity: Date.now(),
    gameState: initialState,
  };

  // Set session first, then cache (ensures atomicity)
  activeSessions.set(gameId, session);
  gameStateCache.set(gameId, initialState);

  logger.info(
    { gameId, totalActive: activeSessions.size },
    'Session registered',
  );
}

/**
 * Unregister a game session and clean up
 * Saves game state to DB before cleanup (checkpoint on disconnect)
 * Only removes the session if the socket matches (prevents stale sockets from removing new sessions)
 */
export async function unregisterSession(
  gameId: string,
  socket?: GameWebSocket,
): Promise<void> {
  const session = activeSessions.get(gameId);
  if (session) {
    // If socket provided, only unregister if it matches the current session
    if (socket && session.socket !== socket) {
      return;
    }

    // Save cached state to DB before cleanup
    const cachedState = gameStateCache.get(gameId);
    if (cachedState) {
      try {
        const games = getDb().collection<GameDoc>('games');
        await games.replaceOne({ _id: gameId }, cachedState);

        // Re-check session still matches AFTER async DB operation
        // Prevents race condition where client reconnects during DB write
        const currentSession = activeSessions.get(gameId);
        if (currentSession === session) {
          // Same session object - safe to delete cache
          gameStateCache.delete(gameId);
        } else {
          // Session was replaced during DB write - don't delete cache
          logger.info(
            { gameId },
            'Session replaced during unregister, keeping new session',
          );
          return;
        }
      } catch (err: unknown) {
        const error = err instanceof Error ? err : new Error(String(err));
        logger.error(
          { err: error, gameId },
          'Failed to save game state on disconnect',
        );
        // Keep cache and session - player can reconnect and we'll have the cached state
        return;
      }
    }

    // Re-check session still matches before deleting
    const currentSession = activeSessions.get(gameId);
    if (currentSession === session) {
      activeSessions.delete(gameId);
      logger.info(
        { gameId, totalActive: activeSessions.size },
        'Session unregistered',
      );
    }
  }
}

/**
 * Get cached game state (in-memory)
 * Returns null if not cached (game not active or doesn't exist)
 */
export function getCachedGameState(gameId: string): GameState | null {
  return gameStateCache.get(gameId) ?? null;
}

/**
 * Update cached game state (in-memory only, no DB write)
 * Call saveGameStateToDb() to persist to database
 */
export function updateCachedGameState(gameId: string, state: GameState): void {
  gameStateCache.set(gameId, state);
  const session = activeSessions.get(gameId);
  if (session) {
    session.gameState = state;
  }
}

/**
 * Save cached game state to database (checkpoint)
 * Called on level descend, death, win, or disconnect
 */
export async function saveGameStateToDb(gameId: string): Promise<void> {
  const cachedState = gameStateCache.get(gameId);
  if (!cachedState) {
    return;
  }

  try {
    const games = getDb().collection<GameDoc>('games');
    const result = await games.replaceOne({ _id: gameId }, cachedState);

    if (result.matchedCount === 0) {
      throw new Error(`Game ${gameId} not found in database`);
    }
  } catch (err: unknown) {
    const error = err instanceof Error ? err : new Error(String(err));
    logger.error({ err: error, gameId }, 'Failed to save game state to DB');
    throw error;
  }
}

/**
 * Update session activity timestamp (called on player actions)
 */
export function updateSessionActivity(gameId: string): void {
  const session = activeSessions.get(gameId);
  if (session) {
    session.lastActivity = Date.now();
  }
}

/**
 * Pause a session (prevents activity timeout during pause)
 */
export function pauseSession(gameId: string): void {
  const session = activeSessions.get(gameId);
  if (session) {
    session.isPaused = true;
  }
}

/**
 * Resume a session and update activity timestamp
 */
export function resumeSession(gameId: string): void {
  const session = activeSessions.get(gameId);
  if (session?.isPaused) {
    session.isPaused = false;
    session.lastActivity = Date.now();
  }
}

// Cleanup interval - starts on demand to prevent multiple intervals in tests
let cleanupInterval: NodeJS.Timeout | null = null;

/**
 * Start the cleanup interval for stale sessions
 * Safe to call multiple times - only starts once
 */
export function startCleanupInterval(): void {
  if (cleanupInterval) return; // Already started

  cleanupInterval = setInterval(async () => {
    const now = Date.now();
    const staleGameIds: string[] = [];

    for (const [gameId, session] of activeSessions) {
      const timeout = session.isPaused
        ? PAUSED_SESSION_TIMEOUT
        : SESSION_TIMEOUT;
      if (now - session.lastActivity > timeout) {
        staleGameIds.push(gameId);
      }
    }

    // Clean up stale sessions (await all cleanup operations)
    const cleanupPromises = staleGameIds.map(async (gameId) => {
      logger.info({ gameId }, 'Cleaning up stale session');

      // Check DB health before attempting cleanup
      const dbHealthy = await isDatabaseHealthy();
      if (!dbHealthy) {
        logger.warn({ gameId }, 'Skipping cleanup: Database unhealthy');
        // Session remains in memory and will be rechecked next cycle if still stale
        // This prevents data loss during DB outages
        return;
      }

      try {
        await unregisterSession(gameId);
      } catch (err: unknown) {
        logger.error({ err, gameId }, 'Failed to cleanup stale session');
        // Don't delete from memory - unregisterSession already handles race conditions
        // and session identity checking. Deleting here would bypass that protection.
      }
    });

    await Promise.all(cleanupPromises);
  }, 60000);
}

// Graceful shutdown - clear interval and cleanup sessions
// Exported so it can be called from index.ts
export async function cleanupAllSessions(): Promise<void> {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
  const sessionIds = Array.from(activeSessions.keys());
  await Promise.allSettled(sessionIds.map((id) => unregisterSession(id)));
}
