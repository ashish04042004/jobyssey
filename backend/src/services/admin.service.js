import { QUEUE_NAMES } from '../queues/index.js';
import { notFound, AppError } from '../utils/errors.js';
import { WORKER_HEARTBEAT_KEY } from '../workers/heartbeat.js';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const JOB_STATES = ['waiting', 'active', 'delayed', 'failed', 'completed', 'paused'];
const QUEUE_KEYS = Object.fromEntries(Object.entries(QUEUE_NAMES).map(([key, name]) => [name, key]));

const ratio = (part, whole) => (whole ? Math.round((part / whole) * 1000) / 1000 : null);

function toFailedJobDto(job) {
  return {
    id: job.id,
    name: job.name,
    failedReason: job.failedReason ?? null,
    attemptsMade: job.attemptsMade,
    maxAttempts: job.opts?.attempts ?? 1,
    createdAt: new Date(job.timestamp).toISOString(),
    failedAt: job.finishedOn ? new Date(job.finishedOn).toISOString() : null,
    data: job.data,
  };
}

/**
 * Operational view for admins: product usage plus the health of the async
 * pipeline (outbox lag, queue depth, failed jobs). `queues` is optional so
 * the API still boots when Redis-backed queues are not wired in.
 */
export function createAdminService({ prisma, redis, queues }) {
  function queueFor(name) {
    const queue = queues?.[QUEUE_KEYS[name]];
    if (!queue) throw notFound('Queue not found');
    return queue;
  }

  async function queueStats() {
    if (!queues) return [];
    return Promise.all(
      Object.values(QUEUE_NAMES).map(async (name) => {
        const counts = await queueFor(name).getJobCounts(...JOB_STATES);
        return { name, counts };
      }),
    );
  }

  async function workerStatus() {
    const raw = await redis.get(WORKER_HEARTBEAT_KEY).catch(() => null);
    if (!raw) return { status: 'down', lastHeartbeatAt: null };
    const { at, workerId } = JSON.parse(raw);
    return { status: 'ok', lastHeartbeatAt: at, workerId };
  }

  return {
    async metrics(now = new Date()) {
      const weekAgo = new Date(now.getTime() - WEEK_MS);

      const [
        users,
        newUsers,
        activeUsers,
        applications,
        applicationsCreated,
        applicationsUpdated,
        reminderGroups,
        remindersSent,
        remindersFailed,
        notificationsCreated,
        outboxPending,
        oldestPending,
        outboxRetrying,
        queuesInfo,
        worker,
      ] = await Promise.all([
        prisma.user.count(),
        prisma.user.count({ where: { createdAt: { gte: weekAgo } } }),
        // Every login and token refresh issues a refresh token, so recent
        // tokens are a cheap proxy for weekly active users.
        prisma.refreshToken.findMany({ where: { createdAt: { gte: weekAgo } }, distinct: ['userId'], select: { userId: true } }),
        prisma.application.count(),
        prisma.application.count({ where: { createdAt: { gte: weekAgo } } }),
        prisma.application.count({ where: { updatedAt: { gte: weekAgo } } }),
        prisma.reminder.groupBy({ by: ['status'], _count: { _all: true } }),
        prisma.reminder.count({ where: { status: 'SENT', updatedAt: { gte: weekAgo } } }),
        prisma.reminder.count({ where: { status: 'FAILED', updatedAt: { gte: weekAgo } } }),
        prisma.notification.count({ where: { createdAt: { gte: weekAgo } } }),
        prisma.outboxEvent.count({ where: { publishedAt: null } }),
        prisma.outboxEvent.findFirst({ where: { publishedAt: null }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } }),
        prisma.outboxEvent.count({ where: { publishedAt: null, attempts: { gt: 0 } } }),
        queueStats().catch(() => null),
        workerStatus(),
      ]);

      return {
        generatedAt: now.toISOString(),
        users: { total: users, newLast7Days: newUsers, activeLast7Days: activeUsers.length },
        applications: { total: applications, createdLast7Days: applicationsCreated, updatedLast7Days: applicationsUpdated },
        reminders: {
          byStatus: Object.fromEntries(reminderGroups.map((g) => [g.status, g._count._all])),
          sentLast7Days: remindersSent,
          failedLast7Days: remindersFailed,
          deliveryRate: ratio(remindersSent, remindersSent + remindersFailed),
        },
        notifications: { createdLast7Days: notificationsCreated },
        outbox: {
          pending: outboxPending,
          retrying: outboxRetrying,
          lagSeconds: oldestPending ? Math.max(0, Math.round((now - oldestPending.createdAt) / 1000)) : 0,
        },
        queues: queuesInfo,
        worker,
      };
    },

    async failedJobs(queueName, { limit = 20 } = {}) {
      const jobs = await queueFor(queueName).getFailed(0, limit - 1);
      return jobs.filter(Boolean).map(toFailedJobDto);
    },

    async retryJob(queueName, jobId) {
      const job = await queueFor(queueName).getJob(jobId);
      if (!job) throw notFound('Job not found');
      const state = await job.getState();
      if (state !== 'failed') throw new AppError(409, 'JOB_NOT_FAILED', `Only failed jobs can be retried (job is ${state})`);
      await job.retry('failed');
      return { id: job.id, name: job.name, state: 'waiting' };
    },
  };
}
