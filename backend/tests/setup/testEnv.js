// Integration tests use their own database and Redis DB so they never touch dev data.
export const TEST_ENV = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  DATABASE_URL:
    process.env.TEST_DATABASE_URL ?? 'postgresql://jobyssey:jobyssey@localhost:5432/jobyssey_test?schema=public',
  REDIS_URL: process.env.TEST_REDIS_URL ?? 'redis://localhost:6380/15',
  CORS_ORIGINS: 'http://localhost:5173',
  JWT_ACCESS_SECRET: 'test-only-access-secret-0123456789abcdef',
  COOKIE_SAMESITE: 'lax',
  COOKIE_SECURE: 'false',
};
