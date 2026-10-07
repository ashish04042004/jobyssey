import 'dotenv/config';
import { z } from 'zod';

const booleanString = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.url(),
  // Shared by the API and the in-process worker; keep it under the database
  // plan's connection limit (Supabase's session pooler allows 15 on free).
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),
  REDIS_URL: z.url(),
  // Shared with the Cloudflare Pages `/api` proxy so the API can trust the
  // visitor address it forwards. Unset when the API is called directly.
  PROXY_SECRET: z.string().min(32, 'PROXY_SECRET must be at least 32 characters').optional(),
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:5173')
    .transform((value) => value.split(',').map((origin) => origin.trim()).filter(Boolean)),
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(15 * 60),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  // `lax` when the SPA and API share a site (custom domain or Pages proxy);
  // `none` only if they are genuinely cross-site (requires COOKIE_SECURE=true).
  COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).default('lax'),
  COOKIE_SECURE: z.enum(['true', 'false']).optional(),
  RUN_WORKER_IN_API: booleanString,
  // `local` keeps files on disk behind signed API URLs (dev/tests);
  // `supabase` uploads straight to a private Supabase Storage bucket.
  STORAGE_DRIVER: z.enum(['local', 'supabase']).default('local'),
  STORAGE_LOCAL_DIR: z.string().default('./storage'),
  SUPABASE_URL: z.url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20).optional(),
  SUPABASE_BUCKET: z.string().default('documents'),
});

function loadEnv() {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  const data = parsed.data;
  const cookieSecure = data.COOKIE_SECURE ? data.COOKIE_SECURE === 'true' : data.NODE_ENV === 'production';
  if (data.COOKIE_SAMESITE === 'none' && !cookieSecure) {
    throw new Error('Invalid environment configuration:\n  - COOKIE_SAMESITE=none requires COOKIE_SECURE=true');
  }
  if (data.STORAGE_DRIVER === 'supabase' && !(data.SUPABASE_URL && data.SUPABASE_SERVICE_ROLE_KEY)) {
    throw new Error('Invalid environment configuration:\n  - STORAGE_DRIVER=supabase requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  }
  return Object.freeze({ ...data, COOKIE_SECURE: cookieSecure });
}

export const env = loadEnv();
export const isProduction = env.NODE_ENV === 'production';
