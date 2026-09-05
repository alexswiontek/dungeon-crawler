import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().min(1).max(65535).default(3000),
  MONGODB_URI: z.string().min(1),
  REDIS_URL: z.url(),
  ALLOWED_ORIGINS: z.string().optional(),
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
  CHECKPOINT_COMMAND_INTERVAL: z.coerce.number().int().positive().default(20),
  CHECKPOINT_TIME_INTERVAL_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(30_000),
});

export const config = envSchema.parse(process.env);
