/**
 * Shared logger instance for use across service modules
 * Uses pino for structured logging with appropriate configuration
 */
import pino from 'pino';

const isDevelopment = process.env.NODE_ENV !== 'production';
const isTest = process.env.NODE_ENV === 'test';

// Create logger with environment-appropriate configuration
export const logger = pino({
  level: isTest ? 'silent' : isDevelopment ? 'info' : 'warn',
  transport: isDevelopment
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss',
          ignore: 'pid,hostname',
          errorLikeObjectKeys: ['err', 'error'],
        },
      }
    : undefined,
});

export default logger;
