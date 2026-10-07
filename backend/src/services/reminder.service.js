const LIVE = ['PENDING', 'QUEUED', 'FAILED'];

export const reminderKey = (entityType, entityId, offsetMinutes, targetAt) =>
  `${entityType}:${entityId}:${offsetMinutes}:${targetAt.getTime()}`;

/**
 * Makes the `reminders` rows for one entity match what it should have now.
 * Rows are the source of truth; the worker turns PENDING rows into delayed
 * jobs (docs/architecture.md §7).
 *
 * The job key includes the target time, so a reschedule cancels the old rows
 * and creates new ones, and the worker can tell a stale job from a live one.
 * Rescheduling back to an earlier time revives the matching cancelled rows
 * instead of colliding with them. Reminders whose time has already passed are
 * not created.
 */
export async function syncReminders(tx, { userId, entityType, entityId, targetAt, offsetsMinutes, active, now = new Date() }) {
  const desired = active
    ? offsetsMinutes
        .map((offset) => ({ offset, remindAt: new Date(targetAt.getTime() - offset * 60_000) }))
        .filter(({ remindAt }) => remindAt > now)
        .map(({ offset, remindAt }) => ({ jobKey: reminderKey(entityType, entityId, offset, targetAt), remindAt }))
    : [];
  const keys = desired.map((r) => r.jobKey);

  await tx.reminder.updateMany({
    where: { entityType, entityId, status: { in: LIVE }, jobKey: { notIn: keys } },
    data: { status: 'CANCELLED' },
  });
  if (desired.length === 0) return;

  await tx.reminder.updateMany({
    where: { jobKey: { in: keys }, status: 'CANCELLED' },
    data: { status: 'PENDING', attempts: 0, lastError: null },
  });
  await tx.reminder.createMany({
    data: desired.map(({ jobKey, remindAt }) => ({ userId, entityType, entityId, targetAt, remindAt, jobKey })),
    skipDuplicates: true,
  });
}

export const DEADLINE_REMINDER_OFFSETS = [1440, 180];

/**
 * Deadline reminders for a job the student saved but has not applied to yet.
 * Run by the worker whenever the application or its job changes.
 */
export async function syncDeadlineReminders(db, applicationId, now = new Date()) {
  const application = await db.application.findUnique({ where: { id: applicationId }, include: { job: true } });
  if (!application) return;
  const deadline = application.job.applicationDeadline;
  await syncReminders(db, {
    userId: application.userId,
    entityType: 'application',
    entityId: application.id,
    targetAt: deadline ?? now,
    offsetsMinutes: DEADLINE_REMINDER_OFFSETS,
    active: Boolean(deadline) && application.status === 'SAVED' && !application.deletedAt && application.job.isActive,
    now,
  });
}

export function cancelReminders(tx, entityType, entityIds) {
  return tx.reminder.updateMany({
    where: { entityType, entityId: { in: entityIds }, status: { in: LIVE } },
    data: { status: 'CANCELLED' },
  });
}
