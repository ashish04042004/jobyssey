import { apiAs, createTestContext, createUser, prisma } from './helpers/integration.js';

const ctx = createTestContext();
const api = (user) => apiAs(ctx.app, user);

let admin;
let student;
let other;
let job;

async function track(user, body = {}) {
  const res = await api(user).post('/applications', { jobId: job.id, ...body });
  expect([200, 201]).toContain(res.status);
  return res.body.data;
}

const move = (user, id, body) => api(user).patch(`/applications/${id}/status`, body);

beforeEach(async () => {
  await ctx.reset();
  admin = await createUser('admin@example.com', 'ADMIN');
  student = await createUser('student@example.com');
  other = await createUser('other@example.com');
  job = (await api(admin).post('/jobs', { companyName: 'Microsoft', title: 'SDE', applicationDeadline: new Date(Date.now() + 86_400_000).toISOString() })).body.data;
});
afterAll(() => ctx.close());

describe('POST /api/applications', () => {
  it('tracks a job as applied, back-dated, with the first timeline event', async () => {
    const appliedAt = '2026-10-02T10:00:00.000Z';
    const app = await track(student, { status: 'APPLIED', appliedAt, notes: 'Referred by a senior' });

    expect(app).toMatchObject({ status: 'APPLIED', appliedAt, version: 0 });
    const detail = (await api(student).get(`/applications/${app.id}`)).body.data;
    expect(detail.notes).toBe('Referred by a senior');
    expect(detail.timeline).toEqual([expect.objectContaining({ fromStatus: null, toStatus: 'APPLIED', occurredAt: appliedAt })]);
    expect(detail.allowedTransitions).toEqual(['OA', 'INTERVIEW', 'REJECTED', 'WITHDRAWN']);
    expect(detail.job).toMatchObject({ title: 'SDE', company: { name: 'Microsoft' } });
  });

  it('returns the existing application instead of creating a duplicate', async () => {
    const first = await api(student).post('/applications', { jobId: job.id });
    const second = await api(student).post('/applications', { jobId: job.id, status: 'APPLIED' });

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.data).toMatchObject({ id: first.body.data.id, status: 'SAVED' });
  });

  it('rejects statuses other than SAVED/APPLIED, future dates and foreign resumes', async () => {
    expect((await api(student).post('/applications', { jobId: job.id, status: 'OFFER' })).status).toBe(400);
    const future = new Date(Date.now() + 86_400_000).toISOString();
    expect((await api(student).post('/applications', { jobId: job.id, status: 'APPLIED', appliedAt: future })).status).toBe(400);

    const doc = await prisma.document.create({
      data: { userId: other.id, label: 'CV', filename: 'cv.pdf', mimeType: 'application/pdf', sizeBytes: 1, storageKey: 'k', status: 'READY' },
    });
    expect((await api(student).post('/applications', { jobId: job.id, resumeId: doc.id })).status).toBe(400);
  });
});

describe('PATCH /api/applications/:id/status', () => {
  it('walks the happy path and records every step on the timeline', async () => {
    const { id } = await track(student);
    for (const status of ['APPLIED', 'OA', 'OA_COMPLETED', 'INTERVIEW', 'OFFER', 'ACCEPTED']) {
      const res = await move(student, id, { status, note: `now ${status}` });
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe(status);
    }

    const detail = (await api(student).get(`/applications/${id}`)).body.data;
    expect(detail.timeline.map((e) => e.toStatus)).toEqual(['SAVED', 'APPLIED', 'OA', 'OA_COMPLETED', 'INTERVIEW', 'OFFER', 'ACCEPTED']);
    expect(detail.version).toBe(6);
    expect(detail.appliedAt).not.toBeNull();
    expect(detail.allowedTransitions).toEqual([]);

    const outbox = await prisma.outboxEvent.count({ where: { type: 'application.status_changed', aggregateId: id } });
    expect(outbox).toBe(6);
  });

  it('keeps a back-dated event in recording order and uses it as appliedAt', async () => {
    const { id } = await track(student);
    const occurredAt = '2026-09-30T09:00:00.000Z';
    const res = await move(student, id, { status: 'APPLIED', occurredAt });

    expect(res.body.data.appliedAt).toBe(occurredAt);
    expect(res.body.data.timeline.map((e) => [e.toStatus, e.occurredAt === occurredAt])).toEqual([
      ['SAVED', false],
      ['APPLIED', true],
    ]);
  });

  it('rejects transitions the state machine does not allow and says what is allowed', async () => {
    const { id } = await track(student, { status: 'APPLIED' });
    const res = await move(student, id, { status: 'OFFER' });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'INVALID_TRANSITION', details: { allowed: ['OA', 'INTERVIEW', 'REJECTED', 'WITHDRAWN'] } });
    expect((await prisma.application.findUnique({ where: { id } })).status).toBe('APPLIED');
  });

  it('detects a stale expectedVersion', async () => {
    const { id } = await track(student);
    await move(student, id, { status: 'APPLIED', expectedVersion: 0 });
    const stale = await move(student, id, { status: 'WITHDRAWN', expectedVersion: 0 });

    expect(stale.status).toBe(409);
    expect(stale.body.error).toMatchObject({ code: 'VERSION_CONFLICT', details: { currentVersion: 1, currentStatus: 'APPLIED' } });
  });

  it('lets exactly one of two racing tabs win', async () => {
    const { id } = await track(student, { status: 'APPLIED' });
    const results = await Promise.all([move(student, id, { status: 'OA' }), move(student, id, { status: 'REJECTED' })]);

    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 409]);
    const events = await prisma.applicationEvent.count({ where: { applicationId: id } });
    expect(events).toBe(2);
  });

  it('keeps applications private to their owner', async () => {
    const { id } = await track(student);
    expect((await move(other, id, { status: 'APPLIED' })).status).toBe(404);
    expect((await api(other).get(`/applications/${id}`)).status).toBe(404);
    expect((await api(other).delete(`/applications/${id}`)).status).toBe(404);
  });
});

describe('listing', () => {
  it('filters by status, searches, and returns per-status counts', async () => {
    const second = (await api(admin).post('/jobs', { companyName: 'Adobe', title: 'MTS' })).body.data;
    const third = (await api(admin).post('/jobs', { companyName: 'Amazon', title: 'SDE I' })).body.data;
    await track(student, { status: 'APPLIED' });
    await api(student).post('/applications', { jobId: second.id });
    await api(student).post('/applications', { jobId: third.id, status: 'APPLIED' });
    await track(other);

    const all = (await api(student).get('/applications')).body;
    expect(all.meta.total).toBe(3);
    expect(all.meta.counts).toMatchObject({ SAVED: 1, APPLIED: 2, OFFER: 0 });

    const applied = (await api(student).get('/applications?status=APPLIED&sort=company')).body.data;
    expect(applied.map((a) => a.job.company.name)).toEqual(['Amazon', 'Microsoft']);

    const search = (await api(student).get('/applications?q=adob')).body.data;
    expect(search.map((a) => a.job.title)).toEqual(['MTS']);
  });
});

describe('notes, deletion and prep', () => {
  it('updates notes', async () => {
    const { id } = await track(student);
    const res = await api(student).patch(`/applications/${id}`, { notes: '  Ask about team  ' });
    expect(res.body.data.notes).toBe('Ask about team');
  });

  it('soft-deletes, hides from lists, and starts fresh when tracked again', async () => {
    const { id } = await track(student, { status: 'APPLIED' });
    expect((await api(student).delete(`/applications/${id}`)).status).toBe(204);
    expect((await api(student).get('/applications')).body.meta.total).toBe(0);
    expect((await api(student).get(`/applications/${id}`)).status).toBe(404);

    const again = await api(student).post(`/jobs/${job.id}/save`);
    expect(again.status).toBe(201);
    expect(again.body.data.status).toBe('SAVED');
  });

  it('manages a preparation checklist', async () => {
    const { id } = await track(student);
    const graphs = (await api(student).post(`/applications/${id}/prep`, { topic: 'Graphs' })).body.data;
    await api(student).post(`/applications/${id}/prep`, { topic: 'DP' });

    expect((await api(student).post(`/applications/${id}/prep`, { topic: 'Graphs' })).status).toBe(409);
    expect((await api(student).patch(`/applications/${id}/prep/${graphs.id}`, { isDone: true })).body.data.isDone).toBe(true);
    expect((await api(other).patch(`/applications/${id}/prep/${graphs.id}`, { isDone: false })).status).toBe(404);

    const items = (await api(student).get(`/applications/${id}/prep`)).body.data;
    expect(items.map((i) => [i.topic, i.isDone])).toEqual([['Graphs', true], ['DP', false]]);

    expect((await api(student).delete(`/applications/${id}/prep/${graphs.id}`)).status).toBe(204);
    expect((await api(student).get(`/applications/${id}/prep`)).body.data).toHaveLength(1);
  });
});
