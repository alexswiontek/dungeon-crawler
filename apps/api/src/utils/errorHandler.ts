/**
 * Centralized error handling utilities
 * Provides consistent error logging following Fastify best practices
 * Uses structured logging (pino) when available, falls back to console
 */

import type { FastifyBaseLogger } from 'fastify';

/**
 * Type guard to check if logger is FastifyBaseLogger (pino)
 */
export function isFastifyLogger(
  logger: FastifyBaseLogger | Console,
): logger is FastifyBaseLogger {
  return 'error' in logger && typeof logger.error === 'function';
}

/**
 * Normalize unknown error to Error instance
 */
export function normalizeError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

/**
 * Log an error with context information
 * Handles both Fastify logger (pino) and console fallback
 *
 * @param err - The error to log
 * @param logger - Logger instance (Fastify/pino or Console)
 * @param message - Human-readable error message
 * @param metadata - Additional context to include in structured logs
 * @param level - Log level (error, warn, info, debug)
 */
export function logError(
  err: unknown,
  logger: FastifyBaseLogger | Console,
  message: string,
  metadata?: Record<string, unknown>,
  level: 'error' | 'warn' | 'info' | 'debug' = 'error',
): void {
  const error = normalizeError(err);

  if (isFastifyLogger(logger)) {
    // Structured logging with pino
    logger[level]({ err: error, ...metadata }, message);
  } else {
    // Console fallback
    const logFn =
      level === 'error' || level === 'warn' ? console[level] : console.log;
    logFn(message, error);
  }
}

/**
 * Log and re-throw an error
 * Useful for operations that must propagate failures after logging
 *
 * @param err - The error to log and throw
 * @param logger - Logger instance
 * @param message - Human-readable error message
 * @param metadata - Additional context
 * @returns Never returns (always throws)
 */
export function logAndThrow(
  err: unknown,
  logger: FastifyBaseLogger | Console,
  message: string,
  metadata?: Record<string, unknown>,
): never {
  logError(err, logger, message, metadata, 'error');
  throw normalizeError(err);
}

/**
 * Create an error handler function for catch blocks
 * Returns a function that logs the error without throwing
 *
 * Example: .catch(handleError(logger, 'Failed to send message', { gameId }))
 *
 * @param logger - Logger instance
 * @param message - Human-readable error message
 * @param metadata - Additional context
 * @param level - Log level
 * @returns Error handler function suitable for .catch()
 */
export function handleError(
  logger: FastifyBaseLogger | Console,
  message: string,
  metadata?: Record<string, unknown>,
  level: 'error' | 'warn' | 'info' | 'debug' = 'error',
): (err: unknown) => void {
  return (err: unknown) => {
    logError(err, logger, message, metadata, level);
  };
}
