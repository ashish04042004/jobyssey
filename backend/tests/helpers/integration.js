import pino from 'pino';
import { createApp } from '../../src/app.js';
import { createRedis } from '../../src/config/redis.js';
import { prisma } from '../../src/models/prisma.js';

export { prisma };

export function createTestContext() {
  const redis = createRedis('test');
  const app = createApp({
    logger: pino({ level: 'silent' }),
    corsOrigins: ['http://localhost:5173'],
    prisma,
    redis,
    healthService: { readiness: async () => ({ status: 'ok', checks: {} }) },
  });

  return {
    app,
    redis,
    async reset() {
      const tables = await prisma.$queryRaw`
        SELECT tablename FROM pg_tables
        WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
      const list = tables.map(({ tablename }) => `"${tablename}"`).join(', ');
      await prisma.$executeRawUnsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
      await redis.flushdb();
    },
    async close() {
      await redis.quit();
      await prisma.$disconnect();
    },
  };
}

/** Pulls `name=value` for the refresh cookie out of a Set-Cookie header. */
export function refreshCookieFrom(res) {
  const header = (res.headers['set-cookie'] ?? []).find((c) => c.startsWith('jobyssey_rt='));
  return header ? header.split(';')[0] : null;
}

export const validRegistration = (overrides = {}) => ({
  name: 'Ashish',
  email: 'ashish@example.com',
  password: 'correct-horse-battery',
  college: 'IIT (ISM) Dhanbad',
  branch: 'CSE',
  graduationYear: new Date().getUTCFullYear(),
  ...overrides,
});
