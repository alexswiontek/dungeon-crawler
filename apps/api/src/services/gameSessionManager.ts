import type { GameState } from '@dungeon-crawler/shared';
import { getDb, isDatabaseHealthy } from '@/services/database.js';

// WebSocket interface - use a minimal type that matches what we need
interface GameWebSocket {
  readyState: number;
  send(data: string): void;
}

interface GameDoc extends Omit<GameState, '_id'> {
  _id: string;
}

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

// Cleanup inactive sessions after 5 minutes
const SESSION_TIMEOUT = 5 * 60 * 1000;

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
    activeSessions.delete(gameId);
  }

  // Cache the game state in memory
  gameStateCache.set(gameId, initialState);

  const session: GameSession = {
    gameId,
    socket,
    isPaused: false,
    lastActivity: Date.now(),
    gameState: initialState,
  };

  activeSessions.set(gameId, session);
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
      } catch (err) {
        console.error(
          `Failed to save game state on disconnect: ${gameId}`,
          err,
        );
      }
      gameStateCache.delete(gameId);
    }

    activeSessions.delete(gameId);
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
    await games.replaceOne({ _id: gameId }, cachedState);
  } catch (err) {
    console.error(`Failed to save game state to DB: ${gameId}`, err);
    throw err;
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

// Cleanup stale sessions periodically (every minute)
const cleanupInterval = setInterval(async () => {
  const now = Date.now();
  const staleGameIds: string[] = [];

  for (const [gameId, session] of activeSessions) {
    if (now - session.lastActivity > SESSION_TIMEOUT) {
      staleGameIds.push(gameId);
    }
  }

  // Clean up stale sessions (async cleanup handled properly)
  for (const gameId of staleGameIds) {
    const session = activeSessions.get(gameId);
    // Don't timeout paused sessions
    if (session?.isPaused) continue;

    console.log(`Cleaning up stale session: ${gameId}`);

    // Check DB health before attempting cleanup
    const dbHealthy = await isDatabaseHealthy();
    if (!dbHealthy) {
      console.warn(`Skipping DB cleanup for ${gameId}: Database unhealthy`);
      // Still remove from memory to prevent leak
      activeSessions.delete(gameId);
      gameStateCache.delete(gameId);
      continue;
    }

    unregisterSession(gameId).catch((err) => {
      console.error(`Failed to cleanup stale session ${gameId}:`, err);
      // Remove from memory even if DB write fails
      activeSessions.delete(gameId);
      gameStateCache.delete(gameId);
    });
  }
}, 60000);

// Graceful shutdown - clear interval and cleanup sessions
const gracefulShutdown = async () => {
  clearInterval(cleanupInterval);
  const sessionIds = Array.from(activeSessions.keys());
  await Promise.allSettled(sessionIds.map((id) => unregisterSession(id)));
  process.exit(0);
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);
