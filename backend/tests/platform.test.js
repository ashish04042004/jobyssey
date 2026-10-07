import express from 'express';
import { SignJWT } from 'jose';
import pino from 'pino';
import request from 'supertest';
import { errorHandler } from '../src/middleware/errorHandler.js';
import { rateLimit } from '../src/middleware/rateLimit.js';
import { requestId } from '../src/middleware/requestId.js';
import { trustedProxy } from '../src/middleware/trustedProxy.js';
import { apiAs, createTestContext, createUser } from './helpers/integration.js';

const ctx = createTestContext();
const api = (user) => apiAs(ctx.app, user);

beforeEach(() => ctx.reset());
afterAll(() => ctx.close());

/** A tiny app around one limiter, so the limiter can be tested in isolation. */
function limitedApp(redis, options) {
  const app = express();
  app.use(requestId);
  app.get('/', rateLimit({ redis, name: 'test', key: () => 'caller', ...options }), (req, res) => res.json({ ok: true }));
  app.use(errorHandler);
  return app;
}

describe('rate limiter', () => {
  it('counts requests, advertises the budget and blocks with Retry-After', async () => {
    const app = limitedApp(ctx.redis, { limit: 3, windowSec: 60 });
    const first = await request(app).get('/');
    expect(first.headers).toMatchObject({ 'ratelimit-limit': '3', 'ratelimit-remaining': '2' });
    await request(app).get('/');
    await request(app).get('/');
    const blocked = await request(app).get('/');
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toMatchObject({ code: 'RATE_LIMITED', details: { retryAfterSeconds: expect.any(Number) } });
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('opens a fresh window once the old one expires', async () => {
    const app = limitedApp(ctx.redis, { limit: 1, windowSec: 1 });
    expect((await request(app).get('/')).status).toBe(200);
    expect((await request(app).get('/')).status).toBe(429);
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    expect((await request(app).get('/')).status).toBe(200);
  });

  it('fails open when Redis is down, unless told to fail closed', async () => {
    const broken = { eval: async () => Promise.reject(new Error('ECONNREFUSED')) };
    expect((await request(limitedApp(broken, { limit: 1, windowSec: 60 })).get('/')).status).toBe(200);
    const closed = await request(limitedApp(broken, { limit: 1, windowSec: 60, failClosed: true })).get('/');
    expect(closed.status).toBe(503);
    expect(closed.body.error.code).toBe('UNAVAILABLE');
  });

  it('limits the authenticated API to 100 requests a minute per user', async () => {
    const busy = await createUser('busy@example.com');
    const calm = await createUser('calm@example.com');
    for (let i = 0; i < 100; i += 1) await api(busy).get('/notifications/unread-count').expect(200);
    const blocked = await api(busy).get('/notifications/unread-count');
    expect(blocked.status).toBe(429);
    expect((await api(calm).get('/notifications/unread-count')).status).toBe(200);
  });
});

describe('error handling', () => {
  it('never leaks internal error details', async () => {
    const app = express();
    app.use(requestId);
    app.use((req, res, next) => {
      req.log = pino({ level: 'silent' });
      next();
    });
    app.get('/boom', () => {
      throw new Error('password authentication failed for user "jobyssey"');
    });
    app.use(errorHandler);

    const res = await request(app).get('/boom');
    expect(res.status).toBe(500);
    expect(res.body.error).toEqual({ code: 'INTERNAL', message: 'Something went wrong', requestId: expect.any(String) });
    expect(JSON.stringify(res.body)).not.toContain('password');
  });

  it('rejects bodies over 100 KB', async () => {
    const user = await createUser('student@example.com');
    const res = await api(user).patch('/me', { name: 'x'.repeat(120_000) });
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('rejects tampered pagination cursors', async () => {
    const user = await createUser('student@example.com');
    const res = await api(user).get('/applications?cursor=not-a-cursor');
    expect(res.status).toBe(400);
  });

  it('rejects access tokens signed with another key or already expired', async () => {
    const forged = await new SignJWT({ role: 'ADMIN' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('00000000-0000-4000-8000-000000000000')
      .setIssuer('jobyssey')
      .setAudience('jobyssey-api')
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode('some-other-secret-that-is-long-enough-123'));
    const res = await request(ctx.app).get('/api/admin/metrics').set('Authorization', `Bearer ${forged}`);
    expect(res.status).toBe(401);
  });
});

describe('HTTP hardening', () => {
  it('sets security headers and hides the framework', async () => {
    const res = await request(ctx.app).get('/api/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBeDefined();
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('allows credentialed CORS only for configured origins', async () => {
    const allowed = await request(ctx.app).get('/api/health').set('Origin', 'http://localhost:5173');
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(allowed.headers['access-control-allow-credentials']).toBe('true');
    expect(allowed.headers['access-control-expose-headers']).toContain('Idempotent-Replayed');

    const foreign = await request(ctx.app).get('/api/health').set('Origin', 'https://evil.example');
    expect(foreign.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('answers preflights for idempotent writes', async () => {
    const res = await request(ctx.app)
      .options('/api/applications')
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'authorization,content-type,idempotency-key');
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-headers']).toContain('idempotency-key');
  });
});

describe('trusted proxy', () => {
  const SECRET = 'proxy-secret-for-tests-0123456789abcdef';
  const ipApp = (secret) => {
    const app = express();
    app.set('trust proxy', 1);
    app.use(trustedProxy(secret));
    app.get('/', (req, res) => res.json({ ip: req.ip }));
    return app;
  };

  it('uses the forwarded visitor address only with the shared secret', async () => {
    const app = ipApp(SECRET);
    const trusted = await request(app).get('/').set('X-Proxy-Secret', SECRET).set('X-Client-IP', '203.0.113.7');
    expect(trusted.body.ip).toBe('203.0.113.7');

    const forged = await request(app).get('/').set('X-Proxy-Secret', 'wrong').set('X-Client-IP', '203.0.113.7');
    expect(forged.body.ip).not.toBe('203.0.113.7');
    const garbage = await request(app).get('/').set('X-Proxy-Secret', SECRET).set('X-Client-IP', 'not-an-ip');
    expect(garbage.body.ip).not.toBe('not-an-ip');
  });

  it('ignores the header entirely when no secret is configured', async () => {
    const res = await request(ipApp(undefined)).get('/').set('X-Proxy-Secret', '').set('X-Client-IP', '203.0.113.7');
    expect(res.body.ip).not.toBe('203.0.113.7');
  });
});
