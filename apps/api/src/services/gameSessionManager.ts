import type { GameWebSocket } from '@/types/database.js';
import { SESSION_TIMEOUT } from '@/utils/constants.js';
import { logger } from '@/utils/logger.js';

interface GameSession {
  gameId: string;
  socket: GameWebSocket;
  isPaused: boolean;
  lastActivity: number;
}

const activeSessions = new Map<string, GameSession>();
const PAUSED_SESSION_TIMEOUT = 30 * 60 * 1000;

/**
 * Socket sessions retain lifecycle metadata only. MongoDB is the sole game
 * authority; no domain state is cached or persisted from this adapter.
 */
export function registerSession(gameId: string, socket: GameWebSocket): void {
  const previous = activeSessions.get(gameId);
  if (previous && previous.socket !== socket) {
    previous.socket.close();
  }
  activeSessions.set(gameId, {
    gameId,
    socket,
    isPaused: false,
    lastActivity: Date.now(),
  });
  logger.info(
    { gameId, totalActive: activeSessions.size },
    'Session registered',
  );
}

export function unregisterSession(
  gameId: string,
  socket?: GameWebSocket,
): void {
  const session = activeSessions.get(gameId);
  if (!session || (socket && session.socket !== socket)) return;
  activeSessions.delete(gameId);
  logger.info(
    { gameId, totalActive: activeSessions.size },
    'Session unregistered',
  );
}

export function hasActiveSession(gameId: string): boolean {
  return activeSessions.has(gameId);
}

export function updateSessionActivity(gameId: string): void {
  const session = activeSessions.get(gameId);
  if (session) session.lastActivity = Date.now();
}

export function pauseSession(gameId: string): void {
  const session = activeSessions.get(gameId);
  if (session) session.isPaused = true;
}

export function resumeSession(gameId: string): void {
  const session = activeSessions.get(gameId);
  if (!session) return;
  session.isPaused = false;
  session.lastActivity = Date.now();
}

let cleanupInterval: NodeJS.Timeout | null = null;

export function startCleanupInterval(): void {
  if (cleanupInterval) return;
  cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [gameId, session] of activeSessions) {
      const timeout = session.isPaused
        ? PAUSED_SESSION_TIMEOUT
        : SESSION_TIMEOUT;
      if (now - session.lastActivity <= timeout) continue;
      logger.info({ gameId }, 'Closing stale WebSocket session');
      session.socket.close();
      unregisterSession(gameId, session.socket);
    }
  }, 60_000);
}

export async function cleanupAllSessions(): Promise<void> {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
  for (const session of activeSessions.values()) session.socket.close();
  activeSessions.clear();
}
