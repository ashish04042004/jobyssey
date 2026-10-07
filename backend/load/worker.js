/**
 * Background-pipeline throughput against the running worker (Docker stack).
 *
 *   npm run load:worker -- --count 2000
 *
 * 1. Outbox → relay → BullMQ → event handler: inserts `count` domain events and
 *    measures how long until every one has been handled.
 * 2. Reminder delivery: enqueues `count` due reminders and measures how long
 *    until each is SENT with its notification written.
 *
 * Latency is per item: from insert/enqueue to the moment it finished.
 */
import { randomUUID } from 'node:crypto';
import { env } from '../src/config/env.js';
import { QueueEvents } from 'bullmq';
import { bullConnection, createQueues, QUEUE_NAMES } from '../src/queues/index.js';
import { cleanup, options, prisma, printTable, seedUsers, summarize } from './common.js';

const opts = options({ count: 2000, timeout: 180 });
const HOUR = 60 * 60 * 1000;
const queues = createQueues({ connection: bullConnection(env.REDIS_URL) });

async function waitFor(label, check) {
  const started = Date.now();
  let lastLogged = 0;
  for (;;) {
    const done = await check();
    if (done >= opts.count) return Date.now() - started;
    if (Date.now() - lastLogged > 2_000) {
      console.log(`  ${label}: ${done}/${opts.count}`);
      lastLogged = Date.now();
    }
    if (Date.now() - started > opts.timeout * 1000) throw new Error(`${label} timed out`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

async function outboxPipeline(applications) {
  // Completed jobs are trimmed to the last 1000, so completion is observed on
  // the queue's event stream instead of by looking jobs up afterwards.
  const finished = new Map();
  const queueEvents = new QueueEvents(QUEUE_NAMES.events, { connection: bullConnection(env.REDIS_URL), prefix: 'jobyssey' });
  queueEvents.on('completed', ({ jobId }) => finished.set(jobId, Date.now()));
  await queueEvents.waitUntilReady();

  const created = new Date();
  const events = applications.slice(0, opts.count).map((a) => ({
    id: randomUUID(),
    type: 'application.status_changed',
    aggregateType: 'application',
    aggregateId: a.id,
    payload: { from: 'APPLIED', to: 'APPLIED' },
    createdAt: created,
  }));
  await prisma.outboxEvent.createMany({ data: events });
  const ids = events.map((e) => e.id);

  try {
    const elapsed = await waitFor('events handled', async () => ids.filter((id) => finished.has(id)).length);
    return { elapsed, latencies: ids.map((id) => finished.get(id) - created.getTime()) };
  } finally {
    await queueEvents.close();
  }
}

async function reminderDelivery(applications) {
  const scheduledAt = new Date(Date.now() + 3 * HOUR);
  const picked = applications.slice(0, opts.count);
  await prisma.interview.createMany({
    data: picked.map((a) => ({ applicationId: a.id, userId: a.userId, type: 'TECHNICAL', scheduledAt, reminderOffsetsMinutes: [] })),
  });
  const interviews = await prisma.interview.findMany({ where: { applicationId: { in: picked.map((a) => a.id) } }, select: { id: true, userId: true } });
  await prisma.reminder.createMany({
    data: interviews.map((i) => ({
      userId: i.userId,
      entityType: 'interview',
      entityId: i.id,
      targetAt: scheduledAt,
      remindAt: new Date(),
      status: 'QUEUED',
      jobKey: `load:${i.id}`,
    })),
  });
  const reminders = await prisma.reminder.findMany({ where: { jobKey: { in: interviews.map((i) => `load:${i.id}`) } }, select: { id: true } });

  const enqueued = Date.now();
  for (let i = 0; i < reminders.length; i += 500) {
    await queues.reminders.addBulk(
      reminders.slice(i, i + 500).map((r) => ({ name: 'reminder.fire', data: { reminderId: r.id }, opts: { jobId: r.id } })),
    );
  }
  const ids = reminders.map((r) => r.id);
  const elapsed = await waitFor('reminders sent', () => prisma.reminder.count({ where: { id: { in: ids }, status: 'SENT' } }));
  const sent = await prisma.reminder.findMany({ where: { id: { in: ids } }, select: { updatedAt: true } });
  const notifications = await prisma.notification.count({ where: { dedupeKey: { in: interviews.map((i) => `load:${i.id}`) } } });
  if (notifications !== opts.count) throw new Error(`expected ${opts.count} notifications, found ${notifications}`);
  return { elapsed, latencies: sent.map((r) => r.updatedAt.getTime() - enqueued) };
}

await cleanup();
console.log(`Seeding ${opts.count} users…`);
await seedUsers(opts.count, { appsPerUser: 1 });
const applications = await prisma.application.findMany({
  where: { user: { email: { endsWith: '@load.jobyssey.test' } } },
  select: { id: true, userId: true },
});

const rows = [];
try {
  for (const [name, fn] of [
    ['outbox → relay → event handler', outboxPipeline],
    ['reminder.fire → notification', reminderDelivery],
  ]) {
    console.log(name);
    const { elapsed, latencies } = await fn(applications);
    const latency = summarize(latencies);
    rows.push({
      pipeline: name,
      items: opts.count,
      'seconds': (elapsed / 1000).toFixed(1),
      'items/s': Math.round(opts.count / (elapsed / 1000)),
      'p50 ms': latency.p50,
      'p95 ms': latency.p95,
      'p99 ms': latency.p99,
    });
  }
} finally {
  await prisma.reminder.deleteMany({ where: { jobKey: { startsWith: 'load:' } } });
  console.log(`cleaned up ${await cleanup()} load-test users\n`);
  await queues.close();
  await prisma.$disconnect();
}

printTable(rows, ['pipeline', 'items', 'seconds', 'items/s', 'p50 ms', 'p95 ms', 'p99 ms']);
