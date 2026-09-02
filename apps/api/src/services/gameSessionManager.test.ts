import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GameWebSocket } from '@/types/database.js';
import {
  cleanupAllSessions,
  hasActiveSession,
  pauseSession,
  registerSession,
  resumeSession,
  unregisterSession,
  updateSessionActivity,
} from './gameSessionManager.js';

function socket(): GameWebSocket {
  return { readyState: 1, send: vi.fn(), close: vi.fn() };
}

describe('gameSessionManager transport lifecycle', () => {
  afterEach(async () => {
    await cleanupAllSessions();
  });

  it('tracks socket lifecycle without retaining game state', () => {
    const connection = socket();
    registerSession('game-1', connection);
    expect(hasActiveSession('game-1')).toBe(true);

    updateSessionActivity('game-1');
    pauseSession('game-1');
    resumeSession('game-1');
    unregisterSession('game-1', connection);

    expect(hasActiveSession('game-1')).toBe(false);
  });

  it('closes and replaces a duplicate active connection', () => {
    const first = socket();
    const second = socket();
    registerSession('game-1', first);
    registerSession('game-1', second);

    expect(first.close).toHaveBeenCalledOnce();
    expect(hasActiveSession('game-1')).toBe(true);
    unregisterSession('game-1', first);
    expect(hasActiveSession('game-1')).toBe(true);
  });

  it('closes all sockets during shutdown', async () => {
    const first = socket();
    const second = socket();
    registerSession('game-1', first);
    registerSession('game-2', second);

    await cleanupAllSessions();

    expect(first.close).toHaveBeenCalledOnce();
    expect(second.close).toHaveBeenCalledOnce();
    expect(hasActiveSession('game-1')).toBe(false);
    expect(hasActiveSession('game-2')).toBe(false);
  });
});
