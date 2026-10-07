import { createHash } from 'node:crypto';
import { Worker } from 'bullmq';
import { env } from '../src/config/env.js';
import { bullConnection, createQueues, QUEUE_NAMES } from '../src/queues/index.js';
import { pruneStorage } from '../src/workers/maintenance.js';
import { apiAs, createTestContext, createUser, prisma } from './helpers/integration.js';

const PREFIX = 'jobyssey-test';
const connection = bullConnection(env.REDIS_URL);
const queues = createQueues({ connection, prefix: PREFIX });
const ctx = createTestContext({ queues });
const api = (user) => apiAs(ctx.app, user);
const DAY = 24 * 60 * 60 * 1000;

let admin;
let student;
let job;

beforeEach(async () => {
  await ctx.reset();
  admin = await createUser('admin@example.com', 'ADMIN');
  student = await createUser('student@example.com');
  job = (await api(admin).post('/jobs', { companyName: 'Amazon', title: 'SDE I', locations: ['Gurugram'] })).body.data;
});
afterAll(async () => {
  await queues.close();
  await ctx.close();
});

describe('Idempotency-Key', () => {
  const key = 'test-key-0001';

  it('replays the stored response instead of creating twice', async () => {
    const body = { jobId: job.id, status: 'APPLIED' };
    const first = await api(student).post('/applications', body, { 'Idempotency-Key': key });
    expect(first.status).toBe(201);
    expect(first.headers['idempotent-replayed']).toBeUndefined();

    const second = await api(student).post('/applications', body, { 'Idempotency-Key': key });
    expect(second.status).toBe(201);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(second.body).toEqual(first.body);
    expect(await prisma.application.count()).toBe(1);
  });

  it('treats bodies with reordered keys as the same request', async () => {
    await api(student).post('/applications', { jobId: job.id, status: 'APPLIED' }, { 'Idempotency-Key': key });
    const res = await api(student).post('/applications', { status: 'APPLIED', jobId: job.id }, { 'Idempotency-Key': key });
    expect(res.headers['idempotent-replayed']).toBe('true');
  });

  it('rejects reusing a key for a different request', async () => {
    await api(student).post('/applications', { jobId: job.id }, { 'Idempotency-Key': key });
    const res = await api(student).post('/applications', { jobId: job.id, status: 'APPLIED' }, { 'Idempotency-Key': key });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('scopes keys per user', async () => {
    const other = await createUser('other@example.com');
    await api(student).post('/applications', { jobId: job.id }, { 'Idempotency-Key': key });
    const res = await api(other).post('/applications', { jobId: job.id }, { 'Idempotency-Key': key });
    expect(res.status).toBe(201);
    expect(res.headers['idempotent-replayed']).toBeUndefined();
    expect(await prisma.application.count()).toBe(2);
  });

  /** Simulates a request that claimed `key` for `{ jobId }` but has not answered yet. */
  function seedInProgress(lockedAt) {
    const path = '/api/applications';
    const requestHash = createHash('sha256').update(`POST ${path} ${JSON.stringify({ jobId: job.id })}`).digest('hex');
    return prisma.idempotencyKey.create({
      data: { userId: student.id, key, method: 'POST', path, requestHash, lockedAt, expiresAt: new Date(Date.now() + DAY) },
    });
  }

  it('answers 409 while the original request is still running', async () => {
    await seedInProgress(new Date());
    const res = await api(student).post('/applications', { jobId: job.id }, { 'Idempotency-Key': key });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('IDEMPOTENCY_IN_PROGRESS');
  });

  it('takes over a stale lock left by a crashed request', async () => {
    await seedInProgress(new Date(Date.now() - 60_000));
    const res = await api(student).post('/applications', { jobId: job.id }, { 'Idempotency-Key': key });
    expect(res.status).toBe(201);
    const row = await prisma.idempotencyKey.findFirst();
    expect(row).toMatchObject({ status: 'COMPLETED', responseCode: 201 });
  });

  it('lets an expired key be used again', async () => {
    await api(student).post('/applications', { jobId: job.id }, { 'Idempotency-Key': key });
    await prisma.idempotencyKey.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    await prisma.application.deleteMany();
    const res = await api(student).post('/applications', { jobId: job.id }, { 'Idempotency-Key': key });
    expect(res.status).toBe(201);
    expect(res.headers['idempotent-replayed']).toBeUndefined();
  });

  it('stores 4xx outcomes and replays them', async () => {
    const body = { jobId: '00000000-0000-4000-8000-000000000000' };
    const first = await api(student).post('/applications', body, { 'Idempotency-Key': key });
    expect(first.status).toBe(404);
    const second = await api(student).post('/applications', body, { 'Idempotency-Key': key });
    expect(second.status).toBe(404);
    expect(second.headers['idempotent-replayed']).toBe('true');
  });

  it('collapses concurrent duplicates into a single write', async () => {
    const body = { jobId: job.id, status: 'APPLIED' };
    const results = await Promise.all(
      Array.from({ length: 5 }, () => api(student).post('/applications', body, { 'Idempotency-Key': key })),
    );
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 201).length).toBeGreaterThanOrEqual(1);
    expect(statuses.every((s) => s === 201 || s === 409)).toBe(true);
    expect(await prisma.application.count()).toBe(1);
    expect(await prisma.applicationEvent.count()).toBe(1);
  });

  it('protects status changes and interview scheduling', async () => {
    const app = (await api(student).post('/applications', { jobId: job.id, status: 'APPLIED' })).body.data;
    const status = { status: 'OA', expectedVersion: app.version };
    const a = await api(student).patch(`/applications/${app.id}/status`, status, { 'Idempotency-Key': 'status-key-1' });
    const b = await api(student).patch(`/applications/${app.id}/status`, status, { 'Idempotency-Key': 'status-key-1' });
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(b.headers['idempotent-replayed']).toBe('true');

    const round = { type: 'TECHNICAL', scheduledAt: new Date(Date.now() + 3 * DAY).toISOString() };
    await api(student).post(`/applications/${app.id}/interviews`, round, { 'Idempotency-Key': 'round-key-1' });
    await api(student).post(`/applications/${app.id}/interviews`, round, { 'Idempotency-Key': 'round-key-1' });
    expect(await prisma.interview.count()).toBe(1);
  });

  it('rejects malformed keys', async () => {
    const res = await api(student).post('/applications', { jobId: job.id }, { 'Idempotency-Key': 'short' });
    expect(res.status).toBe(400);
    expect(await prisma.application.count()).toBe(0);
  });

  it('works without a key (opt-in)', async () => {
    const res = await api(student).post(`/jobs/${job.id}/save`);
    expect(res.status).toBe(201);
    expect(await prisma.idempotencyKey.count()).toBe(0);
  });
});

describe('pruneStorage', () => {
  it('removes expired keys, old published outbox rows and long-expired refresh tokens', async () => {
    const now = new Date();
    const old = new Date(now.getTime() - 8 * DAY);
    await prisma.idempotencyKey.createMany({
      data: [
        { userId: student.id, key: 'expired-key', method: 'POST', path: '/x', requestHash: 'h', expiresAt: new Date(now.getTime() - 1000) },
        { userId: student.id, key: 'live-key-01', method: 'POST', path: '/x', requestHash: 'h', expiresAt: new Date(now.getTime() + DAY) },
      ],
    });
    await prisma.outboxEvent.deleteMany();
    await prisma.outboxEvent.createMany({
      data: [
        { type: 'a', aggregateType: 'job', aggregateId: job.id, payload: {}, publishedAt: old },
        { type: 'b', aggregateType: 'job', aggregateId: job.id, payload: {}, publishedAt: now },
        { type: 'c', aggregateType: 'job', aggregateId: job.id, payload: {}, createdAt: old },
      ],
    });
    await prisma.refreshToken.createMany({
      data: [
        { userId: student.id, tokenHash: 'old', familyId: job.id, expiresAt: old },
        { userId: student.id, tokenHash: 'new', familyId: job.id, expiresAt: new Date(now.getTime() + DAY) },
      ],
    });

    expect(await pruneStorage({ prisma }, now)).toEqual({ idempotencyKeys: 1, outboxEvents: 1, refreshTokens: 1 });
    expect((await prisma.outboxEvent.findMany()).map((e) => e.type).sort()).toEqual(['b', 'c']);
    expect(await prisma.idempotencyKey.count()).toBe(1);
    expect(await prisma.refreshToken.count()).toBe(1);
    expect(await pruneStorage({ prisma }, now)).toEqual({ idempotencyKeys: 0, outboxEvents: 0, refreshTokens: 0 });
  });
});

describe('admin', () => {
  it('is admin-only', async () => {
    expect((await api(student).get('/admin/metrics')).status).toBe(403);
    expect((await api(student).get(`/admin/queues/${QUEUE_NAMES.matching}/failed`)).status).toBe(403);
  });

  it('reports usage, outbox lag and queue depth', async () => {
    await api(student).post('/applications', { jobId: job.id, status: 'APPLIED' });
    const res = await api(admin).get('/admin/metrics');
    expect(res.status).toBe(200);
    const m = res.body.data;
    expect(m.users).toMatchObject({ total: 2, newLast7Days: 2 });
    expect(m.applications).toMatchObject({ total: 1, createdLast7Days: 1 });
    expect(m.outbox.pending).toBeGreaterThan(0);
    expect(m.outbox.lagSeconds).toBeGreaterThanOrEqual(0);
    expect(m.queues.map((q) => q.name).sort()).toEqual(Object.values(QUEUE_NAMES).sort());
    expect(m.queues[0].counts).toHaveProperty('failed');
    expect(m.worker.status).toBe('down');
  });

  it('lists failed jobs and retries them', async () => {
    const worker = new Worker(
      QUEUE_NAMES.matching,
      async () => {
        throw new Error('boom');
      },
      { connection, prefix: PREFIX },
    );
    const failed = new Promise((resolve) => worker.once('failed', resolve));
    await queues.matching.add('job.match', { jobId: job.id }, { jobId: 'match-test-1', attempts: 1 });
    await failed;
    await worker.close();

    const list = await api(admin).get(`/admin/queues/${QUEUE_NAMES.matching}/failed`);
    expect(list.status).toBe(200);
    expect(list.body.data).toEqual([
      expect.objectContaining({ id: 'match-test-1', name: 'job.match', failedReason: 'boom', attemptsMade: 1 }),
    ]);

    const retry = await api(admin).post(`/admin/queues/${QUEUE_NAMES.matching}/jobs/match-test-1/retry`);
    expect(retry.status).toBe(200);
    expect(await (await queues.matching.getJob('match-test-1')).getState()).toBe('waiting');

    const again = await api(admin).post(`/admin/queues/${QUEUE_NAMES.matching}/jobs/match-test-1/retry`);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('JOB_NOT_FAILED');
    expect((await api(admin).get('/admin/queues/nope/failed')).status).toBe(404);
  });
});
