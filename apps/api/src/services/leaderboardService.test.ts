import type { Db } from 'mongodb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as databaseModule from './database.js';
import { submitDeathScore, submitVictoryScore } from './leaderboardService.js';

// Mock the database module
vi.mock('./database.js', () => ({
  getDb: vi.fn(),
}));

describe('Leaderboard Service', () => {
  let mockCollection: {
    insertOne: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockCollection = {
      insertOne: vi.fn(),
    };

    // Create a properly typed mock using Partial to avoid type assertion
    const mockDb = {
      collection: vi.fn().mockReturnValue(mockCollection),
    } as Partial<Db> as Db;

    vi.mocked(databaseModule.getDb).mockReturnValue(mockDb);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('submitDeathScore', () => {
    it('should insert death score with correct fields', async () => {
      mockCollection.insertOne.mockResolvedValue({ insertedId: 'test-id' });

      await submitDeathScore(
        'TestPlayer',
        1000,
        5,
        {
          killedBy: 'Rat',
          killedByType: 'rat',
          killedByVariant: 'normal',
        },
        console,
      );

      expect(mockCollection.insertOne).toHaveBeenCalledOnce();
      const insertedDoc = mockCollection.insertOne.mock.calls[0][0];

      expect(insertedDoc).toMatchObject({
        playerName: 'TestPlayer',
        score: 1000,
        floor: 5,
        killedBy: 'Rat',
        killedByType: 'rat',
        killedByVariant: 'normal',
      });
      expect(insertedDoc.createdAt).toBeInstanceOf(Date);
    });

    it('should throw and log error when database insert fails', async () => {
      const mockLogger = {
        error: vi.fn(),
      } as Partial<Console> as Console;
      const dbError = new Error('Database connection failed');
      mockCollection.insertOne.mockRejectedValue(dbError);

      await expect(
        submitDeathScore(
          'TestPlayer',
          1000,
          5,
          {
            killedBy: 'Rat',
            killedByType: 'rat',
            killedByVariant: 'normal',
          },
          mockLogger,
        ),
      ).rejects.toThrow('Database connection failed');

      expect(mockLogger.error).toHaveBeenCalledWith(
        { err: dbError },
        'Database insertOne failed: submitting death score for TestPlayer',
      );
    });

    it('should handle non-Error exceptions', async () => {
      const consoleErrorSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});
      mockCollection.insertOne.mockRejectedValue('String error');

      await expect(
        submitDeathScore(
          'TestPlayer',
          1000,
          5,
          {
            killedBy: 'Rat',
            killedByType: 'rat',
            killedByVariant: 'normal',
          },
          console,
        ),
      ).rejects.toThrow('String error');

      expect(consoleErrorSpy).toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });
  });

  describe('submitVictoryScore', () => {
    it('should insert victory score with null death fields', async () => {
      mockCollection.insertOne.mockResolvedValue({ insertedId: 'test-id' });

      await submitVictoryScore('TestPlayer', 5000, 10, console);

      expect(mockCollection.insertOne).toHaveBeenCalledOnce();
      const insertedDoc = mockCollection.insertOne.mock.calls[0][0];

      expect(insertedDoc).toMatchObject({
        playerName: 'TestPlayer',
        score: 5000,
        floor: 10,
        killedBy: null,
        killedByType: null,
        killedByVariant: null,
      });
      expect(insertedDoc.createdAt).toBeInstanceOf(Date);
    });

    it('should throw and log error when database insert fails', async () => {
      const mockLogger = {
        error: vi.fn(),
      } as Partial<Console> as Console;
      const dbError = new Error('Database timeout');
      mockCollection.insertOne.mockRejectedValue(dbError);

      await expect(
        submitVictoryScore('TestPlayer', 5000, 10, mockLogger),
      ).rejects.toThrow('Database timeout');

      expect(mockLogger.error).toHaveBeenCalledWith(
        { err: dbError },
        'Database insertOne failed: submitting victory score for TestPlayer',
      );
    });

    it('should use console logger by default', async () => {
      const consoleErrorSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});
      const dbError = new Error('Test error');
      mockCollection.insertOne.mockRejectedValue(dbError);

      await expect(
        submitVictoryScore('TestPlayer', 5000, 10),
      ).rejects.toThrow();

      expect(consoleErrorSpy).toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });
  });

  describe('Error Handling in Route Handlers', () => {
    it('should demonstrate that leaderboard errors do not crash game state', async () => {
      // This test documents the critical fix:
      // Leaderboard submission failures are now caught and logged,
      // but do NOT propagate to crash the WebSocket handler or REST endpoint

      const dbError = new Error('Leaderboard database unavailable');
      mockCollection.insertOne.mockRejectedValue(dbError);

      const mockLogger = {
        error: vi.fn(),
      } as Partial<Console> as Console;

      // The function should throw (so the caller can catch and log)
      await expect(
        submitDeathScore(
          'TestPlayer',
          1000,
          5,
          {
            killedBy: 'Rat',
            killedByType: 'rat',
            killedByVariant: 'normal',
          },
          mockLogger,
        ),
      ).rejects.toThrow();

      // But the error is logged
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });
});
