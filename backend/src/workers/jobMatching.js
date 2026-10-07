import { scoreJob } from '../domain/jobMatch.js';
import { toJobDto } from '../services/job.service.js';
import { createNotifications } from '../services/notification.service.js';

export const MATCH_THRESHOLD = 75;
const BATCH = 500;

function describeJob(job) {
  const where = [...job.locations, ...(job.isRemote ? ['Remote'] : [])].join(', ');
  const ctc = job.ctcMaxLpa ?? job.ctcMinLpa;
  return [where, ctc != null && `up to ₹${ctc} LPA`].filter(Boolean).join(' · ') || null;
}

/**
 * Processor for `job.match`: scores a newly published job against every
 * student's preferences and notifies those at or above the threshold. Runs in
 * the worker so publishing a job never waits on scoring all users.
 */
export async function matchJob({ prisma }, jobId, now = new Date()) {
  const row = await prisma.job.findUnique({ where: { id: jobId }, include: { company: true } });
  if (!row || !row.isActive || row.visibility !== 'PUBLIC') return { notified: 0, skipped: 'not-public' };
  if (row.applicationDeadline && row.applicationDeadline <= now) return { notified: 0, skipped: 'closed' };

  const job = toJobDto(row);
  let notified = 0;
  let cursor;
  for (;;) {
    const users = await prisma.user.findMany({
      where: { role: 'STUDENT', id: { not: row.createdById ?? undefined } },
      select: { id: true, preferredRoles: true, preferredLocations: true, graduationYear: true, minCtcLpa: true },
      orderBy: { id: 'asc' },
      take: BATCH,
      ...(cursor && { skip: 1, cursor: { id: cursor } }),
    });
    if (users.length === 0) break;
    cursor = users.at(-1).id;

    const matches = users
      .map((user) => ({ user, score: scoreJob(job, { ...user, minCtcLpa: user.minCtcLpa == null ? null : Number(user.minCtcLpa) }).score }))
      .filter(({ score }) => score >= MATCH_THRESHOLD);

    notified += await createNotifications(
      prisma,
      matches.map(({ user, score }) => ({
        userId: user.id,
        type: 'JOB_MATCH',
        title: `New match: ${job.company.name} — ${job.title} (${score}% match)`,
        body: describeJob(job),
        link: `/jobs/${job.id}`,
        dedupeKey: `job-match:${job.id}`,
      })),
    );
    if (users.length < BATCH) break;
  }
  return { notified };
}
