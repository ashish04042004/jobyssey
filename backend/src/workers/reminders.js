import { createNotifications } from '../services/notification.service.js';

const MINUTE = 60_000;
// A QUEUED reminder this far past due has lost its delayed job (e.g. Redis was flushed).
const LOST_JOB_GRACE_MS = 10 * MINUTE;
const SWEEP_LIMIT = 500;

const INTERVIEW_LABELS = {
  OA: 'online assessment',
  TECHNICAL: 'technical interview',
  HR: 'HR interview',
  MANAGERIAL: 'managerial interview',
  GROUP_DISCUSSION: 'group discussion',
  OTHER: 'interview',
};

/** "in 1 day", "in 3 hours", "in 1 hour", "in 15 minutes", from the time actually left. */
export function describeLead(ms) {
  const minutes = Math.max(1, Math.round(ms / MINUTE));
  if (minutes >= 23 * 60) {
    const days = Math.round(minutes / 1440);
    return `in ${days} day${days === 1 ? '' : 's'}`;
  }
  if (minutes >= 90) return `in ${Math.round(minutes / 60)} hours`;
  if (minutes >= 55) return 'in 1 hour';
  return `in ${minutes} minutes`;
}

const fireJob = (reminder, now) => ({
  name: 'reminder.fire',
  data: { reminderId: reminder.id },
  opts: { jobId: reminder.id, delay: Math.max(0, reminder.remindAt.getTime() - now.getTime()) },
});

/**
 * Turns PENDING reminder rows into delayed BullMQ jobs (jobId = reminder id, so
 * enqueueing twice is a no-op) and marks them QUEUED.
 */
export async function enqueueReminders({ prisma, queues }, reminders, now = new Date()) {
  if (reminders.length === 0) return 0;
  await queues.reminders.addBulk(reminders.map((reminder) => fireJob(reminder, now)));
  const { count } = await prisma.reminder.updateMany({
    where: { id: { in: reminders.map((r) => r.id) }, status: 'PENDING' },
    data: { status: 'QUEUED' },
  });
  return count;
}

/** Brings the queue in line with one entity's reminder rows after it changed. */
export async function syncEntityQueue(deps, entityType, entityId, now = new Date()) {
  const reminders = await deps.prisma.reminder.findMany({ where: { entityType, entityId } });
  await enqueueReminders(deps, reminders.filter((r) => r.status === 'PENDING'), now);

  // Drop delayed jobs for cancelled rows so Redis doesn't hold them for days.
  for (const reminder of reminders.filter((r) => r.status === 'CANCELLED')) {
    const job = await deps.queues.reminders.getJob(reminder.id);
    if (job && (await job.isDelayed())) await job.remove();
  }
}

async function buildNotification(prisma, reminder, now) {
  const lead = describeLead(reminder.targetAt.getTime() - now.getTime());

  if (reminder.entityType === 'interview') {
    const interview = await prisma.interview.findUnique({
      where: { id: reminder.entityId },
      include: { application: { include: { job: { include: { company: true } } } } },
    });
    const live =
      interview &&
      interview.status === 'SCHEDULED' &&
      !interview.application.deletedAt &&
      interview.scheduledAt.getTime() === reminder.targetAt.getTime();
    if (!live) return null;

    const { job } = interview.application;
    const verb = interview.type === 'OA' ? 'opens' : 'starts';
    return {
      type: 'INTERVIEW',
      title: `${job.company.name} ${INTERVIEW_LABELS[interview.type]} ${verb} ${lead}`,
      body: [interview.title || job.title, interview.meetingUrl && 'Link is on the application page'].filter(Boolean).join(' · '),
      link: `/applications/${interview.applicationId}`,
    };
  }

  if (reminder.entityType === 'application') {
    const application = await prisma.application.findUnique({
      where: { id: reminder.entityId },
      include: { job: { include: { company: true } } },
    });
    const live =
      application &&
      !application.deletedAt &&
      application.status === 'SAVED' &&
      application.job.isActive &&
      application.job.applicationDeadline?.getTime() === reminder.targetAt.getTime();
    if (!live) return null;

    const { job } = application;
    return {
      type: 'DEADLINE',
      title: `Applications for ${job.company.name} ${job.title} close ${lead}`,
      body: "You saved this job but haven't marked it as applied.",
      link: `/applications/${application.id}`,
    };
  }

  return null;
}

/**
 * Processor for `reminder.fire`. The row is re-read, so a job that outlived a
 * reschedule or cancellation does nothing. The notification's dedupe key is the
 * reminder's job key, so a retry after a crash cannot notify twice.
 */
export async function fireReminder({ prisma }, reminderId, now = new Date()) {
  const reminder = await prisma.reminder.findUnique({ where: { id: reminderId } });
  if (!reminder || !['PENDING', 'QUEUED'].includes(reminder.status)) return { skipped: 'not-active' };

  if (reminder.targetAt <= now) {
    await prisma.reminder.update({ where: { id: reminderId }, data: { status: 'CANCELLED', lastError: 'Target time passed before delivery' } });
    return { skipped: 'missed' };
  }

  const notification = await buildNotification(prisma, reminder, now);
  if (!notification) {
    await prisma.reminder.update({ where: { id: reminderId }, data: { status: 'CANCELLED', lastError: 'Stale: entity changed' } });
    return { skipped: 'stale' };
  }

  await prisma.$transaction(async (tx) => {
    await createNotifications(tx, [{ ...notification, userId: reminder.userId, dedupeKey: reminder.jobKey }]);
    await tx.reminder.update({ where: { id: reminderId }, data: { status: 'SENT', lastError: null } });
  });
  return { sent: true };
}

export async function markReminderFailed({ prisma }, reminderId, attempts, error) {
  await prisma.reminder.updateMany({
    where: { id: reminderId, status: { in: ['PENDING', 'QUEUED'] } },
    data: { status: 'FAILED', attempts, lastError: String(error?.message ?? error).slice(0, 500) },
  });
}

/**
 * Safety net, run every few minutes: enqueue PENDING rows the event handlers
 * missed, and re-create delayed jobs for QUEUED rows whose job disappeared.
 */
export async function sweepReminders(deps, now = new Date()) {
  const { prisma, queues } = deps;
  const pending = await prisma.reminder.findMany({
    where: { status: 'PENDING' },
    orderBy: { remindAt: 'asc' },
    take: SWEEP_LIMIT,
  });
  const enqueued = await enqueueReminders(deps, pending, now);

  const overdue = await prisma.reminder.findMany({
    where: { status: 'QUEUED', remindAt: { lt: new Date(now.getTime() - LOST_JOB_GRACE_MS) } },
    orderBy: { remindAt: 'asc' },
    take: SWEEP_LIMIT,
  });
  let recovered = 0;
  for (const reminder of overdue) {
    const job = await queues.reminders.getJob(reminder.id);
    if (job && !(await job.isCompleted()) && !(await job.isFailed())) continue;
    if (job) await job.remove();
    await queues.reminders.add('reminder.fire', { reminderId: reminder.id }, { jobId: reminder.id });
    recovered += 1;
  }
  return { enqueued, recovered };
}
