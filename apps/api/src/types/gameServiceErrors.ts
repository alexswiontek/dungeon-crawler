import type {
  GameErrorCode,
  VisibleGameState,
} from '@dungeon-crawler/protocol';

export class GameServiceError extends Error {
  constructor(
    readonly code: GameErrorCode,
    message: string,
    readonly safeContext?: {
      actionId?: string;
      revision?: number;
      state?: VisibleGameState;
    },
  ) {
    super(message);
    this.name = 'GameServiceError';
  }
}

export function isGameServiceError(error: unknown): error is GameServiceError {
  return error instanceof GameServiceError;
}
