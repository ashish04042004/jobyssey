import { syncDeadlineReminders } from '../services/reminder.service.js';
import { syncEntityQueue } from './reminders.js';

async function refreshDeadlineReminders(deps, applicationIds) {
  for (const applicationId of applicationIds) {
    await deps.prisma.$transaction((tx) => syncDeadlineReminders(tx, applicationId));
    await syncEntityQueue(deps, 'application', applicationId);
  }
}

const interviewChanged = (deps, event) => syncEntityQueue(deps, 'interview', event.aggregateId);
const applicationChanged = (deps, event) => refreshDeadlineReminders(deps, [event.aggregateId]);

async function jobChanged(deps, event) {
  const saved = await deps.prisma.application.findMany({
    where: { jobId: event.aggregateId, deletedAt: null },
    select: { id: true },
  });
  await refreshDeadlineReminders(deps, saved.map((a) => a.id));
}

const jobPublished = (deps, event) =>
  deps.queues.matching.add('job.match', { jobId: event.aggregateId }, { jobId: `match-${event.aggregateId}` });

/**
 * Consumers for outbox events (docs/architecture.md §5). Every handler is
 * idempotent: delivery is at-least-once.
 */
export const EVENT_HANDLERS = {
  'interview.scheduled': [interviewChanged],
  'interview.rescheduled': [interviewChanged],
  'interview.cancelled': [interviewChanged],
  'interview.completed': [interviewChanged],
  'application.created': [applicationChanged],
  'application.status_changed': [applicationChanged],
  'application.deleted': [applicationChanged],
  'job.published': [jobPublished, jobChanged],
  'job.updated': [jobChanged],
  'job.archived': [jobChanged],
};

export async function handleEvent(deps, event) {
  const handlers = EVENT_HANDLERS[event.type];
  if (!handlers) {
    deps.logger.debug({ type: event.type }, 'no handler for event');
    return { handled: false };
  }
  for (const handler of handlers) await handler(deps, event);
  return { handled: true };
}
