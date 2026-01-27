import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().min(1).max(65535).default(3000),
  MONGODB_URI: z.string().min(1),
  ALLOWED_ORIGINS: z.string().optional(),
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
});

export const config = envSchema.parse(process.env);
