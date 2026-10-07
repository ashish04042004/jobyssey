import { apiAs, createTestContext, createUser, prisma } from './helpers/integration.js';

const ctx = createTestContext();
const api = (user) => apiAs(ctx.app, user);

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const inFuture = (ms) => new Date(Date.now() + ms).toISOString();

let admin;
let student;
let other;
let job;
let application;

const schedule = (user, body, appId = application.id) => api(user).post(`/applications/${appId}/interviews`, body);
const live = (interviewId) =>
  prisma.reminder.findMany({ where: { entityId: interviewId, status: 'PENDING' }, orderBy: { remindAt: 'asc' } });

beforeEach(async () => {
  await ctx.reset();
  admin = await createUser('admin@example.com', 'ADMIN');
  student = await createUser('student@example.com');
  other = await createUser('other@example.com');
  job = (await api(admin).post('/jobs', { companyName: 'Amazon', title: 'SDE I' })).body.data;
  application = (await api(student).post('/applications', { jobId: job.id, status: 'APPLIED' })).body.data;
});
afterAll(() => ctx.close());

describe('POST /api/applications/:id/interviews', () => {
  it('schedules a round with default 24h + 1h reminders, audit and outbox', async () => {
    const scheduledAt = inFuture(3 * DAY);
    const res = await schedule(student, { type: 'OA', title: 'HackerRank OA', scheduledAt, meetingUrl: 'https://hackerrank.com/x' });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      type: 'OA',
      title: 'HackerRank OA',
      status: 'SCHEDULED',
      scheduledAt,
      reminderOffsetsMinutes: [1440, 60],
      application: { id: application.id, job: { title: 'SDE I', company: { name: 'Amazon' } } },
    });
    expect(res.body.data.reminders.map((r) => r.remindAt)).toEqual([
      new Date(Date.parse(scheduledAt) - DAY).toISOString(),
      new Date(Date.parse(scheduledAt) - HOUR).toISOString(),
    ]);

    const id = res.body.data.id;
    const reminders = await live(id);
    expect(reminders.map((r) => r.jobKey)).toEqual([
      `interview:${id}:1440:${Date.parse(scheduledAt)}`,
      `interview:${id}:60:${Date.parse(scheduledAt)}`,
    ]);
    expect(await prisma.outboxEvent.count({ where: { type: 'interview.scheduled', aggregateId: id } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: 'interview.scheduled', entityId: id } })).toBe(1);

    const detail = (await api(student).get(`/applications/${application.id}`)).body.data;
    expect(detail.interviews).toEqual([expect.objectContaining({ id, meetingUrl: 'https://hackerrank.com/x' })]);
  });

  it('skips reminders whose time has already passed and allows logging past rounds', async () => {
    const soon = await schedule(student, { type: 'TECHNICAL', scheduledAt: inFuture(2 * HOUR) });
    expect((await live(soon.body.data.id)).map((r) => r.jobKey.split(':')[2])).toEqual(['60']);

    const past = await schedule(student, { type: 'HR', scheduledAt: inFuture(-DAY) });
    expect(past.status).toBe(201);
    expect(await live(past.body.data.id)).toHaveLength(0);
  });

  it('validates times, links and reminder offsets', async () => {
    const start = inFuture(DAY);
    const bad = [
      { type: 'OA', scheduledAt: start, endsAt: inFuture(DAY - HOUR) },
      { type: 'OA', scheduledAt: start, meetingUrl: 'javascript:alert(1)' },
      { type: 'OA', scheduledAt: start, reminderOffsetsMinutes: [1] },
      { type: 'PARTY', scheduledAt: start },
      { type: 'OA', scheduledAt: 'tomorrow' },
    ];
    for (const body of bad) expect((await schedule(student, body)).status).toBe(400);

    const deduped = await schedule(student, { type: 'OA', scheduledAt: start, reminderOffsetsMinutes: [60, 1440, 60] });
    expect(deduped.body.data.reminderOffsetsMinutes).toEqual([1440, 60]);
  });

  it("cannot schedule on someone else's application", async () => {
    expect((await schedule(other, { type: 'OA', scheduledAt: inFuture(DAY) })).status).toBe(404);
  });
});

describe('PATCH /api/interviews/:id', () => {
  it('reschedules reminders, and revives them when moved back', async () => {
    const original = inFuture(3 * DAY);
    const { id } = (await schedule(student, { type: 'TECHNICAL', scheduledAt: original })).body.data;
    const originalKeys = (await live(id)).map((r) => r.jobKey);

    const moved = inFuture(5 * DAY);
    const res = await api(student).patch(`/interviews/${id}`, { scheduledAt: moved });
    expect(res.status).toBe(200);
    expect((await live(id)).every((r) => r.targetAt.toISOString() === moved)).toBe(true);
    expect(await prisma.reminder.count({ where: { entityId: id, status: 'CANCELLED' } })).toBe(2);
    expect(await prisma.outboxEvent.count({ where: { type: 'interview.rescheduled' } })).toBe(1);

    await api(student).patch(`/interviews/${id}`, { scheduledAt: original });
    expect((await live(id)).map((r) => r.jobKey)).toEqual(originalKeys);
    expect(await prisma.reminder.count({ where: { entityId: id } })).toBe(4);
  });

  it('changes reminder offsets', async () => {
    const { id } = (await schedule(student, { type: 'HR', scheduledAt: inFuture(3 * DAY) })).body.data;
    await api(student).patch(`/interviews/${id}`, { reminderOffsetsMinutes: [180] });
    expect((await live(id)).map((r) => r.jobKey.split(':')[2])).toEqual(['180']);
  });

  it('cancelling or completing stops reminders; rescheduling a cancelled round restores them', async () => {
    const { id } = (await schedule(student, { type: 'TECHNICAL', scheduledAt: inFuture(3 * DAY) })).body.data;

    const cancelled = await api(student).patch(`/interviews/${id}`, { status: 'CANCELLED' });
    expect(cancelled.body.data.status).toBe('CANCELLED');
    expect(await live(id)).toHaveLength(0);
    expect(await prisma.outboxEvent.count({ where: { type: 'interview.cancelled' } })).toBe(1);

    await api(student).patch(`/interviews/${id}`, { status: 'SCHEDULED' });
    expect(await live(id)).toHaveLength(2);

    await api(student).patch(`/interviews/${id}`, { status: 'COMPLETED' });
    expect(await live(id)).toHaveLength(0);
  });

  it('rejects an end time before the existing start', async () => {
    const { id } = (await schedule(student, { type: 'OA', scheduledAt: inFuture(3 * DAY) })).body.data;
    const res = await api(student).patch(`/interviews/${id}`, { endsAt: inFuture(DAY) });
    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual([expect.objectContaining({ path: 'endsAt' })]);
  });

  it('keeps interviews private', async () => {
    const { id } = (await schedule(student, { type: 'OA', scheduledAt: inFuture(DAY) })).body.data;
    expect((await api(other).get(`/interviews/${id}`)).status).toBe(404);
    expect((await api(other).patch(`/interviews/${id}`, { status: 'CANCELLED' })).status).toBe(404);
    expect((await api(other).delete(`/interviews/${id}`)).status).toBe(404);
    expect((await api(other).get('/interviews')).body.meta.total).toBe(0);
  });

  it('deleting a round cancels its reminders', async () => {
    const { id } = (await schedule(student, { type: 'OA', scheduledAt: inFuture(2 * DAY) })).body.data;
    expect((await api(student).delete(`/interviews/${id}`)).status).toBe(204);
    expect(await prisma.interview.count()).toBe(0);
    expect(await prisma.reminder.count({ where: { entityId: id, status: 'CANCELLED' } })).toBe(2);
  });
});

describe('application side effects', () => {
  it('rejection cancels upcoming rounds and their reminders but keeps past ones', async () => {
    const upcoming = (await schedule(student, { type: 'TECHNICAL', scheduledAt: inFuture(2 * DAY) })).body.data;
    const past = (await schedule(student, { type: 'OA', scheduledAt: inFuture(-DAY) })).body.data;

    await api(student).patch(`/applications/${application.id}/status`, { status: 'INTERVIEW' });
    await api(student).patch(`/applications/${application.id}/status`, { status: 'REJECTED' });

    expect((await prisma.interview.findUnique({ where: { id: upcoming.id } })).status).toBe('CANCELLED');
    expect((await prisma.interview.findUnique({ where: { id: past.id } })).status).toBe('SCHEDULED');
    expect(await live(upcoming.id)).toHaveLength(0);
  });

  it('deleting the application hides its rounds and cancels reminders', async () => {
    const { id } = (await schedule(student, { type: 'OA', scheduledAt: inFuture(DAY) })).body.data;
    await api(student).delete(`/applications/${application.id}`);

    expect((await api(student).get('/interviews')).body.meta.total).toBe(0);
    expect((await api(student).get(`/interviews/${id}`)).status).toBe(404);
    expect(await live(id)).toHaveLength(0);
  });
});

describe('listing and agenda', () => {
  it('lists by range, status and order', async () => {
    await schedule(student, { type: 'OA', title: 'past', scheduledAt: inFuture(-2 * DAY) });
    await schedule(student, { type: 'TECHNICAL', title: 'later', scheduledAt: inFuture(4 * DAY) });
    await schedule(student, { type: 'HR', title: 'soon', scheduledAt: inFuture(DAY) });

    const upcoming = (await api(student).get(`/interviews?from=${encodeURIComponent(new Date().toISOString())}`)).body;
    expect(upcoming.data.map((i) => i.title)).toEqual(['soon', 'later']);

    const past = (await api(student).get(`/interviews?to=${encodeURIComponent(new Date().toISOString())}&order=desc`)).body;
    expect(past.data.map((i) => i.title)).toEqual(['past']);

    expect((await api(student).get('/interviews?status=CANCELLED')).body.meta.total).toBe(0);
    expect((await api(student).get('/interviews?from=2026-10-10T00:00:00Z&to=2026-10-01T00:00:00Z')).status).toBe(400);
  });

  it('merges scheduled rounds with deadlines of saved-but-not-applied jobs', async () => {
    const saved = (await api(admin).post('/jobs', { companyName: 'Adobe', title: 'MTS', applicationDeadline: inFuture(2 * DAY) })).body.data;
    const applied = (await api(admin).post('/jobs', { companyName: 'Google', title: 'SWE', applicationDeadline: inFuture(2 * DAY) })).body.data;
    await api(student).post('/applications', { jobId: saved.id });
    await api(student).post('/applications', { jobId: applied.id, status: 'APPLIED' });
    await schedule(student, { type: 'OA', scheduledAt: inFuture(DAY) });
    const cancelled = (await schedule(student, { type: 'HR', scheduledAt: inFuture(3 * DAY) })).body.data;
    await api(student).patch(`/interviews/${cancelled.id}`, { status: 'CANCELLED' });
    await schedule(student, { type: 'TECHNICAL', scheduledAt: inFuture(30 * DAY) });

    const from = encodeURIComponent(new Date().toISOString());
    const to = encodeURIComponent(inFuture(7 * DAY));
    const res = await api(student).get(`/agenda?from=${from}&to=${to}`);

    expect(res.status).toBe(200);
    expect(res.body.data.map((item) => [item.kind, item.job.company.name])).toEqual([
      ['OA', 'Amazon'],
      ['DEADLINE', 'Adobe'],
    ]);
    expect((await api(student).get(`/agenda?from=${from}&to=${encodeURIComponent(inFuture(90 * DAY))}`)).status).toBe(400);
  });
});
