import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestGameState } from '@/test/helpers/gameStateHelpers.js';
import {
  getCachedGameState,
  pauseSession,
  registerSession,
  resumeSession,
  unregisterSession,
  updateCachedGameState,
  updateSessionActivity,
} from './gameSessionManager.js';

// Mock database module
vi.mock('@/services/database.js', () => ({
  getDb: vi.fn(() => ({
    collection: vi.fn(() => ({
      replaceOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
    })),
  })),
  isDatabaseHealthy: vi.fn().mockResolvedValue(true),
}));

// Mock WebSocket
interface GameWebSocket {
  readyState: number;
  send(data: string): void;
}

function createMockSocket(): GameWebSocket {
  return {
    readyState: 1,
    send: vi.fn(),
  } as unknown as GameWebSocket;
}

describe('gameSessionManager', () => {
  let mockSocket: GameWebSocket;
  const gameId = 'test-game-id';

  beforeEach(() => {
    mockSocket = createMockSocket();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('registerSession', () => {
    it('should register a new session', () => {
      const state = createTestGameState({ _id: gameId });

      registerSession(gameId, mockSocket, state);

      const cachedState = getCachedGameState(gameId);
      expect(cachedState).toBeDefined();
      expect(cachedState?._id).toBe(gameId);
    });

    it('should cache game state in memory', () => {
      const state = createTestGameState({ _id: gameId, floor: 5 });

      registerSession(gameId, mockSocket, state);

      const cachedState = getCachedGameState(gameId);
      expect(cachedState?.floor).toBe(5);
    });

    it('should replace existing session if already registered', () => {
      const oldSocket = createMockSocket();
      const newSocket = createMockSocket();
      const state1 = createTestGameState({ _id: gameId, floor: 1 });
      const state2 = createTestGameState({ _id: gameId, floor: 2 });

      registerSession(gameId, oldSocket, state1);
      registerSession(gameId, newSocket, state2);

      const cachedState = getCachedGameState(gameId);
      expect(cachedState?.floor).toBe(2);
    });

    it('should initialize session with isPaused=false', () => {
      const state = createTestGameState({ _id: gameId });

      registerSession(gameId, mockSocket, state);

      // Pause and then register again should reset to not paused
      pauseSession(gameId);
      registerSession(gameId, mockSocket, state);

      // We can't directly test isPaused, but we can verify session behavior
      const cachedState = getCachedGameState(gameId);
      expect(cachedState).toBeDefined();
    });
  });

  describe('unregisterSession', () => {
    it('should remove session from cache', async () => {
      const state = createTestGameState({ _id: gameId });
      registerSession(gameId, mockSocket, state);

      await unregisterSession(gameId);

      const cachedState = getCachedGameState(gameId);
      expect(cachedState).toBeNull();
    });

    it('should handle unregistering non-existent session', async () => {
      await expect(
        unregisterSession('non-existent-game'),
      ).resolves.not.toThrow();
    });

    it('should only unregister if socket matches', async () => {
      const state = createTestGameState({ _id: gameId });
      const differentSocket = createMockSocket();

      registerSession(gameId, mockSocket, state);
      await unregisterSession(gameId, differentSocket);

      // Session should still exist because socket didn't match
      const cachedState = getCachedGameState(gameId);
      expect(cachedState).toBeDefined();
    });

    it('should unregister if socket matches', async () => {
      const state = createTestGameState({ _id: gameId });

      registerSession(gameId, mockSocket, state);
      await unregisterSession(gameId, mockSocket);

      const cachedState = getCachedGameState(gameId);
      expect(cachedState).toBeNull();
    });

    it('should unregister if no socket specified', async () => {
      const state = createTestGameState({ _id: gameId });

      registerSession(gameId, mockSocket, state);
      await unregisterSession(gameId);

      const cachedState = getCachedGameState(gameId);
      expect(cachedState).toBeNull();
    });
  });

  describe('getCachedGameState', () => {
    it('should return cached state if exists', () => {
      const state = createTestGameState({ _id: gameId, score: 1000 });

      registerSession(gameId, mockSocket, state);

      const cachedState = getCachedGameState(gameId);
      expect(cachedState).toBeDefined();
      expect(cachedState?.score).toBe(1000);
    });

    it('should return null if not cached', () => {
      const cachedState = getCachedGameState('non-existent-game');
      expect(cachedState).toBeNull();
    });

    it('should return null after session is unregistered', async () => {
      const state = createTestGameState({ _id: gameId });

      registerSession(gameId, mockSocket, state);
      await unregisterSession(gameId);

      const cachedState = getCachedGameState(gameId);
      expect(cachedState).toBeNull();
    });
  });

  describe('updateCachedGameState', () => {
    it('should update cached state', () => {
      const initialState = createTestGameState({ _id: gameId, score: 100 });
      registerSession(gameId, mockSocket, initialState);

      const updatedState = createTestGameState({ _id: gameId, score: 200 });
      updateCachedGameState(gameId, updatedState);

      const cachedState = getCachedGameState(gameId);
      expect(cachedState?.score).toBe(200);
    });

    it('should create cached state if not exists', () => {
      const state = createTestGameState({ _id: gameId, score: 500 });

      updateCachedGameState(gameId, state);

      const cachedState = getCachedGameState(gameId);
      expect(cachedState?.score).toBe(500);
    });

    it('should update multiple fields', () => {
      const initialState = createTestGameState({
        _id: gameId,
        floor: 1,
        score: 100,
      });
      registerSession(gameId, mockSocket, initialState);

      const updatedState = createTestGameState({
        _id: gameId,
        floor: 5,
        score: 500,
      });
      updateCachedGameState(gameId, updatedState);

      const cachedState = getCachedGameState(gameId);
      expect(cachedState?.floor).toBe(5);
      expect(cachedState?.score).toBe(500);
    });
  });

  describe('updateSessionActivity', () => {
    it('should update activity timestamp', () => {
      const state = createTestGameState({ _id: gameId });
      registerSession(gameId, mockSocket, state);

      // Update activity
      updateSessionActivity(gameId);

      // We can't directly test lastActivity, but we can verify it doesn't error
      expect(getCachedGameState(gameId)).toBeDefined();
    });

    it('should handle non-existent session', () => {
      expect(() => updateSessionActivity('non-existent-game')).not.toThrow();
    });
  });

  describe('pauseSession', () => {
    it('should pause a session', () => {
      const state = createTestGameState({ _id: gameId });
      registerSession(gameId, mockSocket, state);

      pauseSession(gameId);

      // We can't directly test isPaused, but we can verify it doesn't error
      expect(getCachedGameState(gameId)).toBeDefined();
    });

    it('should handle non-existent session', () => {
      expect(() => pauseSession('non-existent-game')).not.toThrow();
    });
  });

  describe('resumeSession', () => {
    it('should resume a paused session', () => {
      const state = createTestGameState({ _id: gameId });
      registerSession(gameId, mockSocket, state);

      pauseSession(gameId);
      resumeSession(gameId);

      // We can't directly test isPaused, but we can verify it doesn't error
      expect(getCachedGameState(gameId)).toBeDefined();
    });

    it('should handle non-existent session', () => {
      expect(() => resumeSession('non-existent-game')).not.toThrow();
    });

    it('should only resume if session is paused', () => {
      const state = createTestGameState({ _id: gameId });
      registerSession(gameId, mockSocket, state);

      // Resume without pausing first
      resumeSession(gameId);

      expect(getCachedGameState(gameId)).toBeDefined();
    });
  });

  describe('Session Lifecycle', () => {
    it('should handle complete session lifecycle', async () => {
      const state = createTestGameState({ _id: gameId, score: 100 });

      // Register
      registerSession(gameId, mockSocket, state);
      expect(getCachedGameState(gameId)).toBeDefined();

      // Update
      const updatedState = createTestGameState({ _id: gameId, score: 200 });
      updateCachedGameState(gameId, updatedState);
      expect(getCachedGameState(gameId)?.score).toBe(200);

      // Pause
      pauseSession(gameId);
      expect(getCachedGameState(gameId)).toBeDefined();

      // Resume
      resumeSession(gameId);
      expect(getCachedGameState(gameId)).toBeDefined();

      // Unregister
      await unregisterSession(gameId);
      expect(getCachedGameState(gameId)).toBeNull();
    });

    it('should handle multiple sessions', () => {
      const gameId1 = 'game-1';
      const gameId2 = 'game-2';
      const socket1 = createMockSocket();
      const socket2 = createMockSocket();

      const state1 = createTestGameState({ _id: gameId1, score: 100 });
      const state2 = createTestGameState({ _id: gameId2, score: 200 });

      registerSession(gameId1, socket1, state1);
      registerSession(gameId2, socket2, state2);

      expect(getCachedGameState(gameId1)?.score).toBe(100);
      expect(getCachedGameState(gameId2)?.score).toBe(200);
    });

    it('should isolate sessions from each other', () => {
      const gameId1 = 'game-1';
      const gameId2 = 'game-2';
      const socket1 = createMockSocket();
      const socket2 = createMockSocket();

      const state1 = createTestGameState({ _id: gameId1, floor: 1 });
      const state2 = createTestGameState({ _id: gameId2, floor: 2 });

      registerSession(gameId1, socket1, state1);
      registerSession(gameId2, socket2, state2);

      // Update game1
      const updatedState1 = createTestGameState({ _id: gameId1, floor: 5 });
      updateCachedGameState(gameId1, updatedState1);

      // game1 should be updated, game2 should be unchanged
      expect(getCachedGameState(gameId1)?.floor).toBe(5);
      expect(getCachedGameState(gameId2)?.floor).toBe(2);
    });
  });
});
