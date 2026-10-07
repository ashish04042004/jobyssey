import { summarizeFunnel } from '../domain/funnel.js';

const DASHBOARD_TTL_SEC = 5 * 60;
const STALE_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;
const ACTIVE_STATUSES = ['APPLIED', 'OA', 'OA_COMPLETED', 'INTERVIEW'];

/**
 * Read-only aggregates over a user's own data. Numbers are computed on the fly
 * from applications, application_events and interviews (a student has at most
 * a few hundred applications, so this stays cheap). Months are bucketed in the
 * caller's time zone.
 */
export function createAnalyticsService({ prisma, cache }) {
  const dashboardNamespace = (userId) => `dash:${userId}`;

  async function pipeline(userId) {
    const groups = await prisma.application.groupBy({
      by: ['status'],
      where: { userId, deletedAt: null },
      _count: { _all: true },
    });
    return Object.fromEntries(groups.map((g) => [g.status, g._count._all]));
  }

  async function thisMonth(userId, tz) {
    const [row] = await prisma.$queryRaw`
      WITH bounds AS (
        SELECT (date_trunc('month', now() AT TIME ZONE ${tz}) AT TIME ZONE ${tz}) AS start
      )
      SELECT
        (SELECT count(*) FROM applications a, bounds
          WHERE a.user_id = ${userId}::uuid AND a.deleted_at IS NULL AND a.applied_at >= bounds.start)::int AS applications,
        (SELECT count(*) FROM interviews i, bounds
          WHERE i.user_id = ${userId}::uuid AND i.status <> 'CANCELLED' AND i.scheduled_at >= bounds.start
            AND i.scheduled_at < bounds.start + interval '1 month')::int AS interviews,
        (SELECT count(*) FROM application_events e JOIN applications a ON a.id = e.application_id, bounds
          WHERE a.user_id = ${userId}::uuid AND a.deleted_at IS NULL AND e.to_status = 'OFFER'
            AND e.occurred_at >= bounds.start)::int AS offers`;
    return row;
  }

  async function staleApplications(userId, now) {
    const stale = await prisma.application.findMany({
      where: {
        userId,
        deletedAt: null,
        status: { in: ACTIVE_STATUSES },
        statusChangedAt: { lte: new Date(now.getTime() - STALE_DAYS * DAY_MS) },
      },
      orderBy: { statusChangedAt: 'asc' },
      take: 5,
      select: { id: true, status: true, statusChangedAt: true, job: { select: { title: true, company: { select: { name: true } } } } },
    });
    return stale.map((a) => ({
      id: a.id,
      company: a.job.company.name,
      title: a.job.title,
      status: a.status,
      daysSinceUpdate: Math.floor((now - a.statusChangedAt) / DAY_MS),
    }));
  }

  async function nextSevenDays(userId, now) {
    const until = new Date(now.getTime() + 7 * DAY_MS);
    const [interviews, deadlines] = await Promise.all([
      prisma.interview.count({ where: { userId, status: 'SCHEDULED', scheduledAt: { gte: now, lt: until } } }),
      prisma.application.count({
        where: { userId, deletedAt: null, status: 'SAVED', job: { applicationDeadline: { gte: now, lt: until } } },
      }),
    ]);
    return { interviews, deadlines };
  }

  return {
    async dashboard(user, { tz }) {
      const version = await cache.version(dashboardNamespace(user.id));
      return cache.remember(`${dashboardNamespace(user.id)}:v${version}:${tz}`, DASHBOARD_TTL_SEC, async () => {
        const now = new Date();
        const [pipelineCounts, month, stale, upcoming] = await Promise.all([
          pipeline(user.id),
          thisMonth(user.id, tz),
          staleApplications(user.id, now),
          nextSevenDays(user.id, now),
        ]);
        return { generatedAt: now.toISOString(), pipeline: pipelineCounts, thisMonth: month, nextSevenDays: upcoming, staleApplications: stale };
      });
    },

    /** Drops the cached dashboard after anything that changes its numbers. */
    invalidate(userId) {
      return cache.bump(dashboardNamespace(userId));
    },

    async applications(user, { from, to, months, tz }) {
      const rows = await prisma.$queryRaw`
        SELECT a.status::text AS status, a.applied_at AS "appliedAt", c.name AS company,
               coalesce(array_agg(e.to_status::text) FILTER (WHERE e.id IS NOT NULL), '{}') AS statuses
        FROM applications a
        JOIN jobs j ON j.id = a.job_id
        JOIN companies c ON c.id = j.company_id
        LEFT JOIN application_events e ON e.application_id = a.id
        WHERE a.user_id = ${user.id}::uuid AND a.deleted_at IS NULL
          AND coalesce(a.applied_at, a.created_at) >= ${from ?? new Date(0)}
          AND coalesce(a.applied_at, a.created_at) < ${to ?? new Date('9999-01-01')}
        GROUP BY a.id, c.name`;

      const monthly = await prisma.$queryRaw`
        WITH months AS (
          SELECT generate_series(
            date_trunc('month', now() AT TIME ZONE ${tz}) - make_interval(months => ${months - 1}),
            date_trunc('month', now() AT TIME ZONE ${tz}),
            interval '1 month') AS m
        )
        SELECT to_char(m, 'YYYY-MM') AS month,
          (SELECT count(*) FROM applications a
            WHERE a.user_id = ${user.id}::uuid AND a.deleted_at IS NULL
              AND date_trunc('month', a.applied_at AT TIME ZONE ${tz}) = m)::int AS applications,
          (SELECT count(*) FROM interviews i
            WHERE i.user_id = ${user.id}::uuid AND i.status <> 'CANCELLED'
              AND date_trunc('month', i.scheduled_at AT TIME ZONE ${tz}) = m)::int AS interviews,
          (SELECT count(*) FROM application_events e JOIN applications a ON a.id = e.application_id
            WHERE a.user_id = ${user.id}::uuid AND a.deleted_at IS NULL AND e.to_status = 'OFFER'
              AND date_trunc('month', e.occurred_at AT TIME ZONE ${tz}) = m)::int AS offers
        FROM months
        ORDER BY m`;

      return {
        range: { from: from?.toISOString() ?? null, to: to?.toISOString() ?? null, tz },
        ...summarizeFunnel(rows),
        monthly,
      };
    },
  };
}
