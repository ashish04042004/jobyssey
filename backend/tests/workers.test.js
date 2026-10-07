import pino from 'pino';
import { env } from '../src/config/env.js';
import { bullConnection, createQueues } from '../src/queues/index.js';
import { handleEvent } from '../src/workers/eventHandlers.js';
import { startWorkerRuntime } from '../src/workers/index.js';
import { matchJob } from '../src/workers/jobMatching.js';
import { relayOutboxBatch } from '../src/workers/outboxRelay.js';
import { describeLead, fireReminder, sweepReminders } from '../src/workers/reminders.js';
import { sweepStaleApplications } from '../src/workers/staleApplications.js';
import { apiAs, createTestContext, createUser, prisma } from './helpers/integration.js';

const ctx = createTestContext();
const api = (user) => apiAs(ctx.app, user);
const logger = pino({ level: 'silent' });
const PREFIX = 'jobyssey-test';
const queues = createQueues({ connection: bullConnection(env.REDIS_URL), prefix: PREFIX });
const deps = { prisma, queues, logger };

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const inFuture = (ms) => new Date(Date.now() + ms).toISOString();

let admin;
let student;
let job;
let application;

/** Relays the outbox and runs every resulting event through the handlers, like the worker does. */
async function processOutbox() {
  const events = await prisma.outboxEvent.findMany({ where: { publishedAt: null }, orderBy: { createdAt: 'asc' } });
  await relayOutboxBatch(deps);
  for (const event of events) await handleEvent(deps, event);
  return events.map((e) => e.type);
}

async function waitFor(check, timeoutMs = 10_000) {
  const started = Date.now();
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() - started > timeoutMs) throw new Error('Timed out waiting for condition');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

beforeEach(async () => {
  await ctx.reset();
  admin = await createUser('admin@example.com', 'ADMIN');
  student = await createUser('student@example.com', 'STUDENT', {
    preferredRoles: ['SDE'],
    preferredLocations: ['Delhi NCR'],
    minCtcLpa: 15,
  });
  job = (await api(admin).post('/jobs', { companyName: 'Amazon', title: 'SDE I', locations: ['Gurugram'], ctcMaxLpa: 30 })).body.data;
  application = (await api(student).post('/applications', { jobId: job.id, status: 'APPLIED' })).body.data;
});
afterAll(async () => {
  await queues.close();
  await ctx.close();
});

describe('outbox relay', () => {
  it('publishes each event once, keyed by event id, even if marking failed', async () => {
    const relayed = await relayOutboxBatch(deps);
    expect(relayed).toBeGreaterThanOrEqual(2);
    expect(await prisma.outboxEvent.count({ where: { publishedAt: null } })).toBe(0);
    expect(await relayOutboxBatch(deps)).toBe(0);

    const event = await prisma.outboxEvent.findFirst({ where: { type: 'application.created' } });
    expect((await queues.events.getJob(event.id)).data).toMatchObject({ type: 'application.created', aggregateId: application.id });

    // Crash between enqueue and marking: the next relay re-publishes, BullMQ dedupes by id.
    const before = await queues.events.getJobCountByTypes('waiting', 'delayed', 'completed');
    await prisma.outboxEvent.updateMany({ data: { publishedAt: null } });
    await relayOutboxBatch(deps);
    expect(await queues.events.getJobCountByTypes('waiting', 'delayed', 'completed')).toBe(before);
  });
});

describe('interview reminders', () => {
  async function scheduleInterview(body = {}) {
    const res = await api(student).post(`/applications/${application.id}/interviews`, { type: 'OA', scheduledAt: inFuture(2 * DAY), ...body });
    await processOutbox();
    return res.body.data;
  }

  it('turns reminder rows into delayed jobs and removes them when cancelled', async () => {
    const interview = await scheduleInterview();
    const reminders = await prisma.reminder.findMany({ where: { entityId: interview.id } });
    expect(reminders.map((r) => r.status)).toEqual(['QUEUED', 'QUEUED']);
    for (const r of reminders) {
      const queued = await queues.reminders.getJob(r.id);
      expect(await queued.isDelayed()).toBe(true);
      expect(Math.abs(queued.delay - (r.remindAt.getTime() - Date.now()))).toBeLessThan(5_000);
    }

    await api(student).patch(`/interviews/${interview.id}`, { status: 'CANCELLED' });
    await processOutbox();
    for (const r of reminders) expect(await queues.reminders.getJob(r.id)).toBeUndefined();
  });

  it('delivers exactly one notification per reminder, even when fired twice', async () => {
    const interview = await scheduleInterview({ title: 'HackerRank OA', meetingUrl: 'https://hackerrank.com/t' });
    const [dayBefore] = await prisma.reminder.findMany({ where: { entityId: interview.id }, orderBy: { remindAt: 'asc' } });

    expect(await fireReminder(deps, dayBefore.id, dayBefore.remindAt)).toEqual({ sent: true });
    await prisma.reminder.update({ where: { id: dayBefore.id }, data: { status: 'QUEUED' } });
    expect(await fireReminder(deps, dayBefore.id, dayBefore.remindAt)).toEqual({ sent: true });
    expect(await fireReminder(deps, dayBefore.id, dayBefore.remindAt)).toEqual({ skipped: 'not-active' });

    const notifications = await prisma.notification.findMany({ where: { userId: student.id } });
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({
      type: 'INTERVIEW',
      title: 'Amazon online assessment opens in 1 day',
      body: 'HackerRank OA · Link is on the application page',
      link: `/applications/${application.id}`,
      dedupeKey: dayBefore.jobKey,
    });
  });

  it('skips stale and missed reminders', async () => {
    const interview = await scheduleInterview();
    const [first, second] = await prisma.reminder.findMany({ where: { entityId: interview.id }, orderBy: { remindAt: 'asc' } });

    // The round moved without the reminders being re-synced: the old job must not fire.
    await prisma.interview.update({ where: { id: interview.id }, data: { scheduledAt: new Date(Date.now() + 3 * DAY) } });
    expect(await fireReminder(deps, first.id)).toEqual({ skipped: 'stale' });

    expect(await fireReminder(deps, second.id, new Date(Date.now() + 3 * DAY))).toEqual({ skipped: 'missed' });
    expect((await prisma.reminder.findUnique({ where: { id: second.id } })).status).toBe('CANCELLED');
    expect(await prisma.notification.count()).toBe(0);
  });

  it('sweep enqueues missed PENDING rows and recovers lost delayed jobs', async () => {
    const interview = await api(student).post(`/applications/${application.id}/interviews`, { type: 'HR', scheduledAt: inFuture(2 * DAY) });
    const ids = (await prisma.reminder.findMany({ where: { entityId: interview.body.data.id } })).map((r) => r.id);

    expect(await sweepReminders(deps)).toEqual({ enqueued: 2, recovered: 0 });

    // Redis loses the job and the reminder is now overdue.
    await (await queues.reminders.getJob(ids[0])).remove();
    await prisma.reminder.update({ where: { id: ids[0] }, data: { remindAt: new Date(Date.now() - HOUR) } });
    expect(await sweepReminders(deps)).toEqual({ enqueued: 0, recovered: 1 });
    expect(await queues.reminders.getJob(ids[0])).toBeDefined();
  });

  it('describes the time left in words', () => {
    expect(describeLead(DAY)).toBe('in 1 day');
    expect(describeLead(7 * DAY)).toBe('in 7 days');
    expect(describeLead(3 * HOUR)).toBe('in 3 hours');
    expect(describeLead(HOUR)).toBe('in 1 hour');
    expect(describeLead(15 * 60_000)).toBe('in 15 minutes');
  });
});

describe('deadline reminders', () => {
  it('reminds about saved jobs until the student applies, and follows deadline changes', async () => {
    const deadline = inFuture(3 * DAY);
    const saved = (await api(admin).post('/jobs', { companyName: 'Adobe', title: 'MTS', applicationDeadline: deadline })).body.data;
    const app = (await api(student).post('/applications', { jobId: saved.id })).body.data;
    await processOutbox();

    const live = () => prisma.reminder.findMany({ where: { entityId: app.id, status: { in: ['PENDING', 'QUEUED'] } }, orderBy: { remindAt: 'asc' } });
    expect((await live()).map((r) => r.remindAt.toISOString())).toEqual([
      new Date(Date.parse(deadline) - DAY).toISOString(),
      new Date(Date.parse(deadline) - 3 * HOUR).toISOString(),
    ]);

    const [dayBefore] = await live();
    await fireReminder(deps, dayBefore.id, dayBefore.remindAt);
    expect(await prisma.notification.findFirst({ where: { type: 'DEADLINE' } })).toMatchObject({
      title: 'Applications for Adobe MTS close in 1 day',
      link: `/applications/${app.id}`,
    });

    const extended = inFuture(5 * DAY);
    await api(admin).patch(`/jobs/${saved.id}`, { applicationDeadline: extended });
    expect(await processOutbox()).toEqual(['job.updated']);
    expect((await live()).every((r) => r.targetAt.toISOString() === extended)).toBe(true);

    await api(student).patch(`/applications/${app.id}/status`, { status: 'APPLIED' });
    await processOutbox();
    expect(await live()).toHaveLength(0);
  });
});

describe('job matching', () => {
  it('notifies students whose preferences match a newly published job, once', async () => {
    const outsider = await createUser('designer@example.com', 'STUDENT', { preferredRoles: ['Product'], preferredLocations: ['Mumbai'] });
    const newJob = (await api(admin).post('/jobs', { companyName: 'Microsoft', title: 'Software Engineer', locations: ['Noida'], ctcMaxLpa: 40 })).body.data;
    await processOutbox();

    const queued = await queues.matching.getJob(`match-${newJob.id}`);
    expect(queued.data).toEqual({ jobId: newJob.id });

    expect(await matchJob(deps, newJob.id)).toEqual({ notified: 1 });
    expect(await matchJob(deps, newJob.id)).toEqual({ notified: 0 });

    const notification = await prisma.notification.findFirst({ where: { type: 'JOB_MATCH' } });
    expect(notification).toMatchObject({ userId: student.id, link: `/jobs/${newJob.id}` });
    expect(notification.title).toBe('New match: Microsoft — Software Engineer (100% match)');
    expect(await prisma.notification.count({ where: { userId: outsider.id } })).toBe(0);
    expect(await prisma.notification.count({ where: { userId: admin.id } })).toBe(0);
  });

  it('ignores private jobs', async () => {
    const privateJob = (await api(student).post('/jobs', { companyName: 'Startup', title: 'SDE', locations: ['Noida'] })).body.data;
    expect(await matchJob(deps, privateJob.id)).toMatchObject({ notified: 0, skipped: 'not-public' });
  });
});

describe('stale applications', () => {
  it('nudges once per status after two weeks without an update', async () => {
    await prisma.application.update({ where: { id: application.id }, data: { statusChangedAt: new Date(Date.now() - 20 * DAY) } });

    expect(await sweepStaleApplications(deps)).toEqual({ checked: 1, notified: 1 });
    expect(await sweepStaleApplications(deps)).toEqual({ checked: 1, notified: 0 });
    expect(await prisma.notification.findFirst()).toMatchObject({
      type: 'STALE_APPLICATION',
      title: 'No update on Amazon for 20 days',
    });

    await api(student).patch(`/applications/${application.id}/status`, { status: 'OA' });
    expect(await sweepStaleApplications(deps)).toEqual({ checked: 0, notified: 0 });
  });
});

describe('notifications API', () => {
  beforeEach(async () => {
    await prisma.notification.createMany({
      data: [
        { userId: student.id, type: 'SYSTEM', title: 'one', createdAt: new Date(Date.now() - 2_000) },
        { userId: student.id, type: 'SYSTEM', title: 'two', createdAt: new Date(Date.now() - 1_000) },
        { userId: admin.id, type: 'SYSTEM', title: 'not yours' },
      ],
    });
  });

  it('lists newest first with unread counts, and marks read', async () => {
    const list = (await api(student).get('/notifications')).body;
    expect(list.data.map((n) => n.title)).toEqual(['two', 'one']);
    expect(list.meta).toMatchObject({ total: 2, unread: 2 });

    const read = await api(student).patch(`/notifications/${list.data[0].id}/read`);
    expect(read.body.data.readAt).not.toBeNull();
    expect((await api(student).get('/notifications/unread-count')).body.data.count).toBe(1);
    expect((await api(student).get('/notifications?unread=true')).body.data.map((n) => n.title)).toEqual(['one']);

    expect((await api(student).patch('/notifications/read-all')).body.data.updated).toBe(1);
    expect((await api(student).get('/notifications/unread-count')).body.data.count).toBe(0);
    expect((await api(admin).get('/notifications/unread-count')).body.data.count).toBe(1);
  });

  it("cannot read someone else's notification", async () => {
    const theirs = await prisma.notification.findFirst({ where: { userId: admin.id } });
    expect((await api(student).patch(`/notifications/${theirs.id}/read`)).status).toBe(404);
  });
});

describe('worker runtime (end to end)', () => {
  it('relays, schedules and delivers a reminder through real BullMQ workers', async () => {
    const runtime = await startWorkerRuntime({ prisma, redis: ctx.redis, logger, redisUrl: env.REDIS_URL, prefix: `${PREFIX}-e2e`, relayIntervalMs: 50 });
    try {
      const res = await api(student).post(`/applications/${application.id}/interviews`, {
        type: 'TECHNICAL',
        title: 'Round 1',
        scheduledAt: inFuture(2 * DAY),
      });
      const reminders = await waitFor(async () => {
        const rows = await prisma.reminder.findMany({ where: { entityId: res.body.data.id, status: 'QUEUED' } });
        return rows.length === 2 && rows;
      });

      // Pretend the day-before reminder is due now.
      const dayBefore = reminders.sort((a, b) => a.remindAt - b.remindAt)[0];
      await (await runtime.queues.reminders.getJob(dayBefore.id)).promote();

      const notification = await waitFor(() => prisma.notification.findFirst({ where: { userId: student.id, type: 'INTERVIEW' } }));
      expect(notification.title).toBe('Amazon technical interview starts in 2 days');
      expect((await prisma.reminder.findUnique({ where: { id: dayBefore.id } })).status).toBe('SENT');
    } finally {
      await runtime.stop();
    }
  }, 20_000);
});
