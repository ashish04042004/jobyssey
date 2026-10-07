import { Queue } from 'bullmq';

export const QUEUE_NAMES = Object.freeze({
  events: 'domain-events',
  reminders: 'reminders',
  matching: 'job-matching',
});

export const DEFAULT_JOB_OPTIONS = Object.freeze({
  attempts: 5,
  backoff: { type: 'exponential', delay: 2_000 },
  removeOnComplete: 1_000,
  removeOnFail: 5_000,
});

/** BullMQ needs `maxRetriesPerRequest: null` for its blocking connections. */
export const bullConnection = (url) => ({ url, maxRetriesPerRequest: null });

/**
 * Queue producers. Only the worker runtime enqueues: the API writes outbox rows
 * and the relay publishes them, so a Redis outage never fails a user request.
 */
export function createQueues({ connection, prefix = 'jobyssey' }) {
  const make = (name) => new Queue(name, { connection, prefix, defaultJobOptions: DEFAULT_JOB_OPTIONS });
  const queues = {
    events: make(QUEUE_NAMES.events),
    reminders: make(QUEUE_NAMES.reminders),
    matching: make(QUEUE_NAMES.matching),
  };
  return {
    ...queues,
    close: () => Promise.all(Object.values(queues).map((queue) => queue.close())),
  };
}
