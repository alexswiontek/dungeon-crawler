export class GameNotFoundError extends Error {
  constructor(gameId: string) {
    super(`Game not found: ${gameId}`);
    this.name = 'GameNotFoundError';
  }
}

export class GameInactiveError extends Error {
  constructor(gameId: string, status: string) {
    super(`Game ${gameId} is ${status} and cannot be modified`);
    this.name = 'GameInactiveError';
  }
}

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

export class InvalidPlayerNameError extends Error {
  constructor(reason: string) {
    super(`Invalid player name: ${reason}`);
    this.name = 'InvalidPlayerNameError';
  }
}
