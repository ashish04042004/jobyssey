import { Worker } from 'bullmq';
import { bullConnection, createQueues, QUEUE_NAMES } from '../queues/index.js';
import { handleEvent } from './eventHandlers.js';
import { startHeartbeat } from './heartbeat.js';
import { matchJob } from './jobMatching.js';
import { pruneStorage } from './maintenance.js';
import { startOutboxRelay } from './outboxRelay.js';
import { fireReminder, markReminderFailed, sweepReminders } from './reminders.js';
import { sweepStaleApplications } from './staleApplications.js';

const SCHEDULES = [
  { id: 'reminder-sweep', every: 5 * 60_000, name: 'reminder.sweep' },
  { id: 'stale-application-sweep', every: 6 * 60 * 60_000, name: 'application.stale-sweep' },
  { id: 'maintenance-prune', every: 24 * 60 * 60_000, name: 'maintenance.prune' },
];

/**
 * Starts every background processor. Used by the standalone worker process and,
 * when RUN_WORKER_IN_API=true, inside the API process for single-instance hosting.
 * Safe to run several copies: the outbox relay uses SKIP LOCKED and every
 * consumer is idempotent.
 */
export async function startWorkerRuntime({ prisma, redis, logger, redisUrl, prefix = 'jobyssey', relayIntervalMs }) {
  const connection = bullConnection(redisUrl);
  const queues = createQueues({ connection, prefix });
  const deps = { prisma, queues, logger };
  const workerOptions = { connection, prefix };

  const reminderProcessors = {
    'reminder.fire': (job) => fireReminder(deps, job.data.reminderId),
    'reminder.sweep': () => sweepReminders(deps),
    'application.stale-sweep': () => sweepStaleApplications(deps),
    'maintenance.prune': () => pruneStorage(deps),
  };

  const workers = [
    new Worker(QUEUE_NAMES.events, (job) => handleEvent(deps, job.data), { ...workerOptions, concurrency: 5 }),
    new Worker(QUEUE_NAMES.reminders, (job) => reminderProcessors[job.name]?.(job), { ...workerOptions, concurrency: 10 }),
    new Worker(QUEUE_NAMES.matching, (job) => matchJob(deps, job.data.jobId), { ...workerOptions, concurrency: 1 }),
  ];

  for (const worker of workers) {
    worker.on('failed', (job, err) => {
      const final = job && job.attemptsMade >= (job.opts.attempts ?? 1);
      logger.warn({ err, queue: worker.name, job: job?.name, jobId: job?.id, attempt: job?.attemptsMade, final }, 'job failed');
      if (final && job.name === 'reminder.fire') {
        markReminderFailed(deps, job.data.reminderId, job.attemptsMade, err).catch((e) => logger.error({ err: e }, 'could not mark reminder failed'));
      }
    });
    worker.on('error', (err) => logger.error({ err, queue: worker.name }, 'worker error'));
  }

  for (const { id, every, name } of SCHEDULES) {
    await queues.reminders.upsertJobScheduler(id, { every }, { name });
  }

  const relay = startOutboxRelay(deps, { intervalMs: relayIntervalMs });
  const heartbeat = startHeartbeat(redis, logger);
  sweepReminders(deps).catch((err) => logger.warn({ err }, 'startup reminder sweep failed'));
  logger.info({ workerId: heartbeat.workerId, queues: Object.values(QUEUE_NAMES) }, 'worker runtime started');

  return {
    queues,
    async stop() {
      heartbeat.stop();
      await relay.stop();
      await Promise.all(workers.map((worker) => worker.close()));
      await queues.close();
    },
  };
}
