import request from 'supertest';
import { createTestContext, prisma, refreshCookieFrom, validRegistration } from './helpers/integration.js';

const ORIGIN = 'http://localhost:5173';
const ctx = createTestContext();

beforeEach(() => ctx.reset());
afterAll(() => ctx.close());

async function register(overrides) {
  const res = await request(ctx.app).post('/api/auth/register').send(validRegistration(overrides));
  expect(res.status).toBe(201);
  return { res, accessToken: res.body.data.accessToken, cookie: refreshCookieFrom(res), user: res.body.data.user };
}

const refresh = (cookie) => {
  const req = request(ctx.app).post('/api/auth/refresh').set('Origin', ORIGIN);
  return cookie ? req.set('Cookie', cookie) : req;
};

describe('POST /api/auth/register', () => {
  it('creates the account, returns an access token and sets an HttpOnly refresh cookie', async () => {
    const { res, user } = await register({ email: '  Ashish@Example.COM ' });

    expect(user).toMatchObject({ email: 'ashish@example.com', name: 'Ashish', role: 'STUDENT', preferredRoles: [] });
    expect(user).not.toHaveProperty('passwordHash');
    expect(res.body.data.accessToken).toEqual(expect.any(String));

    const cookie = res.headers['set-cookie'].find((c) => c.startsWith('jobyssey_rt='));
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/Path=\/api\/auth/);
    expect(cookie).toMatch(/SameSite=Lax/);

    const stored = await prisma.user.findUnique({ where: { email: 'ashish@example.com' } });
    expect(stored.passwordHash).toMatch(/^\$argon2id\$/);

    const audit = await prisma.auditLog.findMany({ where: { actorId: stored.id } });
    expect(audit.map((a) => a.action)).toEqual(['auth.register']);
  });

  it('rejects a duplicate email regardless of case', async () => {
    await register();
    const res = await request(ctx.app)
      .post('/api/auth/register')
      .send(validRegistration({ email: 'ASHISH@example.com' }));

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('validates input and reports every bad field', async () => {
    const res = await request(ctx.app)
      .post('/api/auth/register')
      .send(validRegistration({ email: 'not-an-email', password: 'short', graduationYear: 1990 }));

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.map((d) => d.path).sort()).toEqual(['email', 'graduationYear', 'password']);
  });

  it('ignores attempts to self-assign a role', async () => {
    const { user } = await register({ role: 'ADMIN' });
    expect(user.role).toBe('STUDENT');
  });
});

describe('POST /api/auth/login', () => {
  beforeEach(() => register());

  it('logs in with the right password', async () => {
    const res = await request(ctx.app)
      .post('/api/auth/login')
      .send({ email: 'ASHISH@example.com', password: 'correct-horse-battery' });

    expect(res.status).toBe(200);
    expect(res.body.data.user.email).toBe('ashish@example.com');
    expect(refreshCookieFrom(res)).not.toBeNull();
  });

  it('returns the same error for a wrong password and an unknown email', async () => {
    const wrongPassword = await request(ctx.app)
      .post('/api/auth/login')
      .send({ email: 'ashish@example.com', password: 'wrong-password-123' });
    const unknownEmail = await request(ctx.app)
      .post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: 'wrong-password-123' });

    for (const res of [wrongPassword, unknownEmail]) {
      expect(res.status).toBe(401);
      expect(res.body.error).toMatchObject({ code: 'INVALID_CREDENTIALS', message: 'Incorrect email or password' });
    }
  });

  it('rate-limits to 5 attempts per minute per IP and email', async () => {
    const attempt = () =>
      request(ctx.app).post('/api/auth/login').send({ email: 'ashish@example.com', password: 'wrong-password-123' });

    for (let i = 0; i < 5; i += 1) expect((await attempt()).status).toBe(401);
    const blocked = await attempt();

    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);

    const otherAccount = await request(ctx.app)
      .post('/api/auth/login')
      .send({ email: 'someone-else@example.com', password: 'wrong-password-123' });
    expect(otherAccount.status).toBe(401);
  });
});

describe('POST /api/auth/refresh', () => {
  it('rotates the refresh token and issues a new access token', async () => {
    const { cookie } = await register();
    const res = await refresh(cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toEqual(expect.any(String));
    const rotated = refreshCookieFrom(res);
    expect(rotated).not.toBeNull();
    expect(rotated).not.toBe(cookie);
    expect((await refresh(rotated)).status).toBe(200);
  });

  it('tolerates two tabs refreshing with the same cookie at once', async () => {
    const { cookie } = await register();
    const first = await refresh(cookie);
    const second = await refresh(cookie);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(refreshCookieFrom(second)).toBeNull();
    expect((await refresh(refreshCookieFrom(first))).status).toBe(200);
  });

  it('revokes the whole session family when an old token is replayed', async () => {
    const { cookie, user } = await register();
    const rotated = refreshCookieFrom(await refresh(cookie));

    // Move the original rotation outside the race-tolerance window.
    await prisma.refreshToken.updateMany({
      where: { userId: user.id, revokedAt: { not: null } },
      data: { revokedAt: new Date(Date.now() - 5 * 60_000) },
    });

    const replay = await refresh(cookie);
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe('UNAUTHENTICATED');

    expect((await refresh(rotated)).status).toBe(401);
    const audit = await prisma.auditLog.findFirst({ where: { action: 'auth.refresh_reuse_detected' } });
    expect(audit).not.toBeNull();
  });

  it('rejects requests without a cookie, with an unknown cookie, or from a foreign origin', async () => {
    const { cookie } = await register();

    expect((await refresh()).status).toBe(401);
    expect((await refresh('jobyssey_rt=made-up')).status).toBe(401);

    const foreign = await request(ctx.app)
      .post('/api/auth/refresh')
      .set('Origin', 'https://evil.example')
      .set('Cookie', cookie);
    expect(foreign.status).toBe(403);
  });

  it('rejects an expired refresh token', async () => {
    const { cookie, user } = await register();
    await prisma.refreshToken.updateMany({ where: { userId: user.id }, data: { expiresAt: new Date(Date.now() - 1000) } });

    expect((await refresh(cookie)).status).toBe(401);
  });
});

describe('POST /api/auth/logout', () => {
  it('revokes the session and clears the cookie', async () => {
    const { cookie } = await register();
    const res = await request(ctx.app).post('/api/auth/logout').set('Origin', ORIGIN).set('Cookie', cookie);

    expect(res.status).toBe(204);
    expect(res.headers['set-cookie'].join(';')).toMatch(/jobyssey_rt=;/);
    expect((await refresh(cookie)).status).toBe(401);
  });

  it('succeeds even without a session', async () => {
    const res = await request(ctx.app).post('/api/auth/logout').set('Origin', ORIGIN);
    expect(res.status).toBe(204);
  });
});

describe('/api/me', () => {
  it('requires a valid access token', async () => {
    expect((await request(ctx.app).get('/api/me')).status).toBe(401);

    const { accessToken } = await register();
    const tampered = `${accessToken.slice(0, -2)}xx`;
    const res = await request(ctx.app).get('/api/me').set('Authorization', `Bearer ${tampered}`);
    expect(res.status).toBe(401);
  });

  it('returns the current profile', async () => {
    const { accessToken } = await register();
    const res = await request(ctx.app).get('/api/me').set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ email: 'ashish@example.com', college: 'IIT (ISM) Dhanbad' });
  });

  it('updates preferences and de-duplicates list entries', async () => {
    const { accessToken } = await register();
    const res = await request(ctx.app)
      .patch('/api/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ preferredRoles: ['SDE', 'Backend', 'sde'], preferredLocations: ['Delhi NCR', 'Remote'], minCtcLpa: 15 });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      preferredRoles: ['sde', 'Backend'],
      preferredLocations: ['Delhi NCR', 'Remote'],
      minCtcLpa: 15,
    });
  });

  it('refuses to change protected fields', async () => {
    const { accessToken } = await register();
    const res = await request(ctx.app)
      .patch('/api/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ role: 'ADMIN', email: 'other@example.com' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});
