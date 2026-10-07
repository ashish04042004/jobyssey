import pino from 'pino';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createHealthService } from '../src/services/health.service.js';

const logger = pino({ level: 'silent' });

function buildApp({ dbOk = true, redisOk = true, heartbeat = null } = {}) {
  const prisma = {
    $queryRaw: async () => {
      if (!dbOk) throw new Error('connection refused');
      return [{ '?column?': 1 }];
    },
  };
  const redis = {
    ping: async () => {
      if (!redisOk) throw new Error('connection refused');
      return 'PONG';
    },
    get: async () => heartbeat,
  };
  const healthService = createHealthService({ prisma, redis });
  return createApp({ logger, corsOrigins: ['http://localhost:5173'], healthService, version: '9.9.9' });
}

describe('GET /api/health', () => {
  it('reports liveness without touching dependencies', async () => {
    const res = await request(buildApp({ dbOk: false, redisOk: false })).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: 'ok', version: '9.9.9' });
    expect(res.headers['x-request-id']).toBeDefined();
  });

  it('echoes a well-formed client request id', async () => {
    const res = await request(buildApp()).get('/api/health').set('X-Request-Id', 'abc-123');

    expect(res.headers['x-request-id']).toBe('abc-123');
  });
});

describe('GET /api/health/ready', () => {
  it('is ready when database and redis are up, with a live worker', async () => {
    const heartbeat = JSON.stringify({ workerId: 'w1', at: '2026-10-07T17:00:00.000Z' });
    const res = await request(buildApp({ heartbeat })).get('/api/health/ready');

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('ok');
    expect(res.body.data.checks.database.status).toBe('ok');
    expect(res.body.data.checks.redis.status).toBe('ok');
    expect(res.body.data.checks.worker).toEqual({ status: 'ok', lastHeartbeatAt: '2026-10-07T17:00:00.000Z' });
  });

  it('stays ready but reports the worker as degraded when there is no heartbeat', async () => {
    const res = await request(buildApp()).get('/api/health/ready');

    expect(res.status).toBe(200);
    expect(res.body.data.checks.worker.status).toBe('degraded');
  });

  it('returns 503 when the database is down', async () => {
    const res = await request(buildApp({ dbOk: false })).get('/api/health/ready');

    expect(res.status).toBe(503);
    expect(res.body.data.status).toBe('error');
    expect(res.body.data.checks.database).toEqual({ status: 'error', error: 'connection refused' });
  });

  it('returns 503 when redis is down', async () => {
    const res = await request(buildApp({ redisOk: false })).get('/api/health/ready');

    expect(res.status).toBe(503);
    expect(res.body.data.checks.redis.status).toBe('error');
  });
});

describe('error handling', () => {
  it('returns the error envelope for unknown routes', async () => {
    const res = await request(buildApp()).get('/api/nope');

    expect(res.status).toBe(404);
    expect(res.body.error).toMatchObject({ code: 'NOT_FOUND', requestId: expect.any(String) });
  });

  it('rejects malformed JSON with a validation error', async () => {
    const res = await request(buildApp())
      .post('/api/health')
      .set('Content-Type', 'application/json')
      .send('{"broken":');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});
