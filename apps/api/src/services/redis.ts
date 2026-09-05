import { createClient, type RedisClientType } from 'redis';
import { logger } from '@/utils/logger.js';

let client: RedisClientType | null = null;

export async function connectToRedis(): Promise<RedisClientType> {
  if (client?.isReady) return client;
  const url = process.env.REDIS_URL;
  if (!url) throw new Error('Please define the REDIS_URL environment variable');

  const next = createClient({ url });
  next.on('error', (error) => {
    logger.error({ errorName: error.name }, 'Redis client error');
  });
  await next.connect();
  client = next as RedisClientType;
  logger.info('Connected to Redis');
  return client;
}

export function getRedis(): RedisClientType {
  if (!client?.isReady) {
    throw new Error('Redis not connected. Call connectToRedis first.');
  }
  return client;
}

export async function closeRedis(): Promise<void> {
  const current = client;
  client = null;
  if (!current?.isOpen) return;
  await current.quit();
  logger.info('Disconnected from Redis');
}

export async function isRedisHealthy(): Promise<boolean> {
  try {
    return (await getRedis().ping()) === 'PONG';
  } catch {
    return false;
  }
}
