/**
 * Custom error types for the game API
 * These provide type-safe, semantic error handling
 */

/**
 * Thrown when a game is not found in the database
 */
export class GameNotFoundError extends Error {
  constructor(gameId: string) {
    super(`Game not found: ${gameId}`);
    this.name = 'GameNotFoundError';
  }
}

/**
 * Thrown when attempting to perform an action on an inactive game
 */
export class GameInactiveError extends Error {
  constructor(gameId: string, status: string) {
    super(`Game ${gameId} is ${status} and cannot be modified`);
    this.name = 'GameInactiveError';
  }
}

/**
 * Thrown when a database operation fails
 */
export class DatabaseOperationError extends Error {
  constructor(operation: string, originalError?: Error) {
    super(
      `Database ${operation} failed: ${originalError?.message || 'Unknown error'}`,
    );
    this.name = 'DatabaseOperationError';
    if (originalError) {
      this.cause = originalError;
    }
  }
}

/**
 * Thrown when a player name is invalid
 */
export class InvalidPlayerNameError extends Error {
  constructor(reason: string) {
    super(`Invalid player name: ${reason}`);
    this.name = 'InvalidPlayerNameError';
  }
}
