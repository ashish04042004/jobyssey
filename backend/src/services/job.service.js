import { matchesLocation, matchesRole, scoreJob } from '../domain/jobMatch.js';
import { forbidden, notFound } from '../utils/errors.js';
import { decodeCursor, nextCursor } from '../utils/pagination.js';
import { recordAudit } from './audit.service.js';
import { hashKey } from './cache.service.js';
import { resolveCompany, toCompanyDto } from './company.service.js';
import { recordEvent } from './outbox.service.js';

// Scoring happens in memory, so cap the candidate set. Comfortable for the
// beta; beyond a few thousand active jobs, move scoring into SQL.
const CANDIDATE_LIMIT = 500;
const PUBLIC_JOBS_TTL_SECONDS = 300;
const CACHE_NAMESPACE = 'jobs';

const toNumber = (decimal) => (decimal === null || decimal === undefined ? null : Number(decimal));
const toIso = (date) => (date ? new Date(date).toISOString() : null);

export function toJobDto(job, { withDescription = false } = {}) {
  return {
    id: job.id,
    company: toCompanyDto(job.company),
    title: job.title,
    roleCategory: job.roleCategory,
    employmentType: job.employmentType,
    locations: job.locations,
    isRemote: job.isRemote,
    ctcMinLpa: toNumber(job.ctcMinLpa),
    ctcMaxLpa: toNumber(job.ctcMaxLpa),
    eligibility: job.eligibility,
    graduationYears: job.graduationYears,
    applicationDeadline: toIso(job.applicationDeadline),
    jobUrl: job.jobUrl,
    visibility: job.visibility,
    isActive: job.isActive,
    createdById: job.createdById,
    createdAt: toIso(job.createdAt),
    updatedAt: toIso(job.updatedAt),
    ...(withDescription && { description: job.description }),
  };
}

/** Filters that Postgres can apply; location/role use synonym matching in JS. */
function databaseFilters({ q, employmentType, graduationYear, minCtc }) {
  const and = [];
  if (q) {
    and.push({
      OR: [
        { title: { contains: q, mode: 'insensitive' } },
        { company: { name: { contains: q, mode: 'insensitive' } } },
        { roleCategory: { contains: q, mode: 'insensitive' } },
      ],
    });
  }
  if (employmentType?.length) and.push({ employmentType: { in: employmentType } });
  if (graduationYear) {
    and.push({ OR: [{ graduationYears: { has: graduationYear } }, { graduationYears: { isEmpty: true } }] });
  }
  if (minCtc !== undefined) {
    and.push({ OR: [{ ctcMaxLpa: { gte: minCtc } }, { ctcMaxLpa: null, ctcMinLpa: { gte: minCtc } }] });
  }
  return { AND: and };
}

const deadlineValue = (job) => (job.applicationDeadline ? Date.parse(job.applicationDeadline) : Infinity);
const SORTS = {
  match: (a, b) => b.matchScore - a.matchScore || deadlineValue(a) - deadlineValue(b) || b.createdAt.localeCompare(a.createdAt),
  deadline: (a, b) => deadlineValue(a) - deadlineValue(b) || b.matchScore - a.matchScore,
  recent: (a, b) => b.createdAt.localeCompare(a.createdAt),
};

export function createJobService({ prisma, cache }) {
  const canEdit = (job, user) => job.createdById === user.id || (user.role === 'ADMIN' && job.visibility === 'PUBLIC');

  async function loadProfile(userId) {
    const profile = await prisma.user.findUnique({
      where: { id: userId },
      select: { preferredRoles: true, preferredLocations: true, graduationYear: true, minCtcLpa: true },
    });
    if (!profile) throw notFound('User not found');
    return { ...profile, minCtcLpa: toNumber(profile.minCtcLpa) };
  }

  async function publicCandidates(where) {
    const version = await cache.version(CACHE_NAMESPACE);
    return cache.remember(`jobs:v${version}:public:${hashKey(where)}`, PUBLIC_JOBS_TTL_SECONDS, async () => {
      const jobs = await prisma.job.findMany({
        where: { AND: [where, { visibility: 'PUBLIC', isActive: true }] },
        include: { company: true },
        orderBy: { createdAt: 'desc' },
        take: CANDIDATE_LIMIT,
      });
      return jobs.map((job) => toJobDto(job));
    });
  }

  async function applicationsFor(userId, jobIds) {
    if (jobIds.length === 0) return new Map();
    const applications = await prisma.application.findMany({
      where: { userId, jobId: { in: jobIds }, deletedAt: null },
      select: { id: true, jobId: true, status: true },
    });
    return new Map(applications.map(({ jobId, ...app }) => [jobId, app]));
  }

  function decorate(job, user, profile, application) {
    const { score, breakdown } = scoreJob(job, profile);
    return { ...job, matchScore: score, matchBreakdown: breakdown, application: application ?? null, canEdit: canEdit(job, user) };
  }

  /** Loads a job the caller may see, or throws 404 without revealing it exists. */
  async function findVisible(user, id) {
    const job = await prisma.job.findUnique({ where: { id }, include: { company: true } });
    if (!job) throw notFound('Job not found');
    if (job.visibility === 'PRIVATE' && job.createdById !== user.id) throw notFound('Job not found');
    if (!job.isActive && job.createdById !== user.id && user.role !== 'ADMIN') {
      const applied = await prisma.application.count({ where: { userId: user.id, jobId: id, deletedAt: null } });
      if (!applied) throw notFound('Job not found');
    }
    return job;
  }

  async function detail(user, job) {
    const [profile, applications] = await Promise.all([loadProfile(user.id), applicationsFor(user.id, [job.id])]);
    return decorate(toJobDto(job, { withDescription: true }), user, profile, applications.get(job.id));
  }

  async function invalidateIfPublic(...visibilities) {
    if (visibilities.includes('PUBLIC')) await cache.bump(CACHE_NAMESPACE);
  }

  return {
    findVisible,

    async list(user, query) {
      const where = databaseFilters(query);
      const ownWhere = { AND: [where, { createdById: user.id, isActive: true }] };
      if (!query.mine) ownWhere.AND.push({ visibility: 'PRIVATE' });

      const [profile, publicJobs, ownJobs] = await Promise.all([
        loadProfile(user.id),
        query.mine ? [] : publicCandidates(where),
        prisma.job
          .findMany({ where: ownWhere, include: { company: true }, orderBy: { createdAt: 'desc' }, take: CANDIDATE_LIMIT })
          .then((jobs) => jobs.map((job) => toJobDto(job))),
      ]);

      const now = Date.now();
      const filtered = [...publicJobs, ...ownJobs].filter(
        (job) =>
          (query.includeExpired || !job.applicationDeadline || Date.parse(job.applicationDeadline) >= now) &&
          (!query.location || matchesLocation(job, query.location)) &&
          (!query.roleCategory || matchesRole(job, query.roleCategory)),
      );

      const scored = filtered.map((job) => decorate(job, user, profile)).sort(SORTS[query.sort]);
      const offset = decodeCursor(query.cursor);
      const page = scored.slice(offset, offset + query.limit);
      const applications = await applicationsFor(user.id, page.map((job) => job.id));

      return {
        data: page.map((job) => ({ ...job, application: applications.get(job.id) ?? null })),
        meta: { total: scored.length, nextCursor: nextCursor(offset, query.limit, scored.length) },
      };
    },

    async get(user, id) {
      return detail(user, await findVisible(user, id));
    },

    async create(user, input, req) {
      const visibility = input.visibility ?? (user.role === 'ADMIN' ? 'PUBLIC' : 'PRIVATE');
      if (visibility === 'PUBLIC' && user.role !== 'ADMIN') {
        throw forbidden('Only admins can publish jobs to everyone. Add it as a private job instead.');
      }
      const { companyId, companyName, ...fields } = input;

      const job = await prisma.$transaction(async (tx) => {
        const company = await resolveCompany(tx, { companyId, companyName });
        const created = await tx.job.create({
          data: { ...fields, visibility, companyId: company.id, createdById: user.id },
          include: { company: true },
        });
        await recordAudit(tx, { actorId: user.id, action: 'job.created', entityType: 'job', entityId: created.id, metadata: { visibility }, req });
        if (visibility === 'PUBLIC') {
          await recordEvent(tx, { type: 'job.published', aggregateType: 'job', aggregateId: created.id, payload: { jobId: created.id } });
        }
        return created;
      });

      await invalidateIfPublic(visibility);
      return detail(user, job);
    },

    async update(user, id, changes, req) {
      const job = await findVisible(user, id);
      if (!canEdit(job, user)) throw forbidden('You can only edit jobs you added');
      if (changes.visibility === 'PUBLIC' && user.role !== 'ADMIN') throw forbidden('Only admins can publish jobs to everyone');

      const { companyId, companyName, ...fields } = changes;
      const updated = await prisma.$transaction(async (tx) => {
        const company = companyId || companyName ? await resolveCompany(tx, { companyId, companyName }) : null;
        const result = await tx.job.update({
          where: { id },
          data: { ...fields, ...(company && { companyId: company.id }) },
          include: { company: true },
        });
        await recordAudit(tx, {
          actorId: user.id,
          action: 'job.updated',
          entityType: 'job',
          entityId: id,
          metadata: { fields: Object.keys(changes) },
          req,
        });
        const published = result.visibility === 'PUBLIC' && job.visibility !== 'PUBLIC';
        await recordEvent(tx, {
          type: published ? 'job.published' : 'job.updated',
          aggregateType: 'job',
          aggregateId: id,
          payload: { jobId: id, fields: Object.keys(changes) },
        });
        return result;
      });

      await invalidateIfPublic(job.visibility, updated.visibility);
      return detail(user, updated);
    },

    async archive(user, id, req) {
      const job = await findVisible(user, id);
      if (!canEdit(job, user)) throw forbidden('You can only remove jobs you added');

      await prisma.$transaction([
        prisma.job.update({ where: { id }, data: { isActive: false } }),
        recordAudit(prisma, { actorId: user.id, action: 'job.archived', entityType: 'job', entityId: id, req }),
        recordEvent(prisma, { type: 'job.archived', aggregateType: 'job', aggregateId: id, payload: { jobId: id } }),
      ]);
      await invalidateIfPublic(job.visibility);
    },
  };
}
