import express from 'express';
import request from 'supertest';
import { authenticate } from '../src/middleware/authenticate.js';
import { requireRole } from '../src/middleware/authorize.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import { signAccessToken } from '../src/utils/tokens.js';

function buildApp() {
  const app = express();
  app.get('/admin-only', authenticate, requireRole('ADMIN'), (req, res) => res.json({ ok: true }));
  app.use(errorHandler);
  return app;
}

const bearer = async (role) => `Bearer ${await signAccessToken({ id: '00000000-0000-0000-0000-000000000001', role })}`;

describe('requireRole', () => {
  it('lets admins through', async () => {
    const res = await request(buildApp()).get('/admin-only').set('Authorization', await bearer('ADMIN'));
    expect(res.status).toBe(200);
  });

  it('forbids students', async () => {
    const res = await request(buildApp()).get('/admin-only').set('Authorization', await bearer('STUDENT'));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('requires authentication first', async () => {
    const res = await request(buildApp()).get('/admin-only');
    expect(res.status).toBe(401);
  });
});
