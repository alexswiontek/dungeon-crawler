import type { FastifyBaseLogger } from 'fastify';

export function isFastifyLogger(
  logger: FastifyBaseLogger | Console,
): logger is FastifyBaseLogger {
  return 'error' in logger && typeof logger.error === 'function';
}

export function normalizeError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

export function logError(
  err: unknown,
  logger: FastifyBaseLogger | Console,
  message: string,
  metadata?: Record<string, unknown>,
  level: 'error' | 'warn' | 'info' | 'debug' = 'error',
): void {
  const error = normalizeError(err);

  if (isFastifyLogger(logger)) {
    logger[level]({ err: error, ...metadata }, message);
  } else {
    const logFn =
      level === 'error' || level === 'warn' ? console[level] : console.log;
    logFn(message, error);
  }
}

export function logAndThrow(
  err: unknown,
  logger: FastifyBaseLogger | Console,
  message: string,
  metadata?: Record<string, unknown>,
): never {
  logError(err, logger, message, metadata, 'error');
  throw normalizeError(err);
}

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
