import { rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import pino from 'pino';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { env } from '../../src/config/env.js';
import { createLocalStorage } from '../../src/storage/localStorage.js';
import { signAccessToken } from '../../src/utils/tokens.js';
import { createRedis } from '../../src/config/redis.js';
import { prisma } from '../../src/models/prisma.js';

export { prisma };

export function createTestContext({ queues } = {}) {
  const redis = createRedis('test');
  const storageDir = path.join(os.tmpdir(), `jobyssey-test-storage-${process.pid}`);
  const storage = createLocalStorage({ dir: storageDir, secret: env.JWT_ACCESS_SECRET });
  const app = createApp({
    logger: pino({ level: 'silent' }),
    corsOrigins: ['http://localhost:5173'],
    prisma,
    redis,
    queues,
    storage,
    healthService: { readiness: async () => ({ status: 'ok', checks: {} }) },
  });

  return {
    app,
    redis,
    storage,
    async reset() {
      const tables = await prisma.$queryRaw`
        SELECT tablename FROM pg_tables
        WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
      const list = tables.map(({ tablename }) => `"${tablename}"`).join(', ');
      await prisma.$executeRawUnsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
      await redis.flushdb();
    },
    async close() {
      await rm(storageDir, { recursive: true, force: true });
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

/** Creates a user directly in the DB and returns it with a ready Authorization header. */
export async function createUser(email, role = 'STUDENT', profile = {}) {
  const { password: _password, ...fields } = validRegistration({ email });
  const user = await prisma.user.create({ data: { ...fields, passwordHash: 'x', role, ...profile } });
  return { ...user, auth: `Bearer ${await signAccessToken(user)}` };
}

/** Supertest shortcuts that send the user's access token (and optional extra headers). */
export function apiAs(app, user) {
  return {
    get: (path) => request(app).get(`/api${path}`).set('Authorization', user.auth),
    post: (path, body, headers = {}) => request(app).post(`/api${path}`).set('Authorization', user.auth).set(headers).send(body),
    patch: (path, body, headers = {}) => request(app).patch(`/api${path}`).set('Authorization', user.auth).set(headers).send(body),
    delete: (path) => request(app).delete(`/api${path}`).set('Authorization', user.auth),
  };
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
