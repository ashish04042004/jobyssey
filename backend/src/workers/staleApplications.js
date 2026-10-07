import { createNotifications } from '../services/notification.service.js';

export const STALE_AFTER_DAYS = 14;
const DAY = 86_400_000;
const LIMIT = 1_000;

const NUDGES = {
  APPLIED: "Heard back? Update the status, or follow up with the recruiter.",
  OA: 'Did you take the OA? Mark it done so your pipeline stays accurate.',
  OA_COMPLETED: 'Waiting on OA results? Consider following up.',
  INTERVIEW: 'Any news after the interview? Update the status or schedule the next round.',
};

/**
 * Nudges students about applications whose status hasn't changed in two weeks.
 * One nudge per application per status: the dedupe key includes the time of
 * the last status change.
 */
export async function sweepStaleApplications({ prisma }, now = new Date()) {
  const cutoff = new Date(now.getTime() - STALE_AFTER_DAYS * DAY);
  const stale = await prisma.application.findMany({
    where: { deletedAt: null, status: { in: Object.keys(NUDGES) }, statusChangedAt: { lt: cutoff } },
    include: { job: { include: { company: true } } },
    orderBy: { statusChangedAt: 'asc' },
    take: LIMIT,
  });

  const notified = await createNotifications(
    prisma,
    stale.map((application) => {
      const days = Math.floor((now - application.statusChangedAt) / DAY);
      return {
        userId: application.userId,
        type: 'STALE_APPLICATION',
        title: `No update on ${application.job.company.name} for ${days} days`,
        body: NUDGES[application.status],
        link: `/applications/${application.id}`,
        dedupeKey: `stale:${application.id}:${application.statusChangedAt.getTime()}`,
      };
    }),
  );
  return { checked: stale.length, notified };
}
