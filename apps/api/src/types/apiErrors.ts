export const ErrorCode = {
  // Game errors
  GAME_NOT_FOUND: 'GAME_NOT_FOUND',
  GAME_NOT_ACTIVE: 'GAME_NOT_ACTIVE',
  NOT_ON_STAIRS: 'NOT_ON_STAIRS',
  INVALID_PLAYER_NAME: 'INVALID_PLAYER_NAME',

  // Database errors
  DATABASE_ERROR: 'DATABASE_ERROR',
  DATABASE_UNAVAILABLE: 'DATABASE_UNAVAILABLE',

  // Validation errors
  INVALID_LIMIT: 'INVALID_LIMIT',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export interface ApiError {
  error: string;
  code: ErrorCode;
  details?: Record<string, unknown>;
}

export function createErrorResponse(
  message: string,
  code: ErrorCode,
  details?: Record<string, unknown>,
): ApiError {
  return {
    error: message,
    code,
    ...(details && { details }),
  };
}
