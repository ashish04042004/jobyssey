import { allowedTransitions, ApplicationStatus, canTransition } from '../domain/applicationStatus.js';
import { badRequest, conflict, notFound } from '../utils/errors.js';
import { decodeCursor, nextCursor } from '../utils/pagination.js';
import { recordAudit } from './audit.service.js';
import { toCompanyDto } from './company.service.js';
import { recordEvent } from './outbox.service.js';

const S = ApplicationStatus;
const iso = (date) => date?.toISOString() ?? null;

const JOB_SUMMARY = {
  select: {
    id: true,
    title: true,
    locations: true,
    isRemote: true,
    applicationDeadline: true,
    jobUrl: true,
    isActive: true,
    visibility: true,
    company: true,
  },
};

function toJobSummary(job) {
  return {
    id: job.id,
    title: job.title,
    company: toCompanyDto(job.company),
    locations: job.locations,
    isRemote: job.isRemote,
    applicationDeadline: iso(job.applicationDeadline),
    jobUrl: job.jobUrl,
    isActive: job.isActive,
    visibility: job.visibility,
  };
}

export function toApplicationSummary(application) {
  return {
    id: application.id,
    jobId: application.jobId,
    status: application.status,
    version: application.version,
    appliedAt: iso(application.appliedAt),
    statusChangedAt: iso(application.statusChangedAt),
    resumeId: application.resumeId,
    createdAt: iso(application.createdAt),
    updatedAt: iso(application.updatedAt),
    ...(application.job && { job: toJobSummary(application.job) }),
  };
}

function toPrepItem(item) {
  return { id: item.id, topic: item.topic, isDone: item.isDone, position: item.position };
}

function toDetail(application) {
  return {
    ...toApplicationSummary(application),
    notes: application.notes,
    allowedTransitions: allowedTransitions(application.status),
    resume: application.resume
      ? { id: application.resume.id, label: application.resume.label, filename: application.resume.filename }
      : null,
    timeline: application.events.map((event) => ({
      id: event.id,
      fromStatus: event.fromStatus,
      toStatus: event.toStatus,
      note: event.note,
      occurredAt: iso(event.occurredAt),
    })),
    interviews: application.interviews.map((interview) => ({
      id: interview.id,
      type: interview.type,
      title: interview.title,
      scheduledAt: iso(interview.scheduledAt),
      endsAt: iso(interview.endsAt),
      status: interview.status,
    })),
    prepItems: application.prepItems.map(toPrepItem),
  };
}

const SORTS = {
  updated: [{ updatedAt: 'desc' }],
  deadline: [{ job: { applicationDeadline: { sort: 'asc', nulls: 'last' } } }, { updatedAt: 'desc' }],
  company: [{ job: { company: { name: 'asc' } } }, { updatedAt: 'desc' }],
};

export function createApplicationService({ prisma, jobService }) {
  const owned = (user, id) => ({ id, userId: user.id, deletedAt: null });

  async function findOwned(user, id, include) {
    const application = await prisma.application.findFirst({ where: owned(user, id), include });
    if (!application) throw notFound('Application not found');
    return application;
  }

  async function loadDetail(user, id) {
    return toDetail(
      await findOwned(user, id, {
        job: JOB_SUMMARY,
        resume: true,
        // Recording order, not occurredAt: back-dated events must not reorder the chain of transitions.
        events: { orderBy: { createdAt: 'asc' } },
        interviews: { orderBy: { scheduledAt: 'asc' } },
        prepItems: { orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] },
      }),
    );
  }

  async function assertOwnResume(user, resumeId) {
    if (!resumeId) return;
    const document = await prisma.document.findFirst({
      where: { id: resumeId, userId: user.id, deletedAt: null, status: 'READY' },
    });
    if (!document) throw badRequest('Unknown resume', [{ path: 'resumeId', message: 'Resume not found' }]);
  }

  return {
    /**
     * Starts tracking a job. Idempotent: if the user already tracks it, the
     * existing application is returned with `created: false`.
     */
    async create(user, { jobId, status = S.SAVED, appliedAt, resumeId = null, notes = null }, req) {
      const job = await jobService.findVisible(user, jobId);
      if (!job.isActive) throw notFound('Job not found');
      await assertOwnResume(user, resumeId);

      const existing = await prisma.application.findUnique({ where: { userId_jobId: { userId: user.id, jobId } } });
      if (existing && !existing.deletedAt) return { application: toApplicationSummary(existing), created: false };

      const occurredAt = status === S.APPLIED ? (appliedAt ?? new Date()) : new Date();
      try {
        const application = await prisma.$transaction(async (tx) => {
          if (existing) {
            // Previously removed from the tracker: start over. The old timeline
            // cascades away; the audit log keeps the history.
            await tx.application.delete({ where: { id: existing.id } });
          }
          const created = await tx.application.create({
            data: {
              userId: user.id,
              jobId,
              status,
              notes,
              resumeId,
              appliedAt: status === S.APPLIED ? occurredAt : null,
            },
          });
          await tx.applicationEvent.create({
            data: { applicationId: created.id, actorId: user.id, fromStatus: null, toStatus: status, occurredAt },
          });
          await recordAudit(tx, {
            actorId: user.id,
            action: 'application.created',
            entityType: 'application',
            entityId: created.id,
            metadata: { jobId, status },
            req,
          });
          await recordEvent(tx, {
            type: 'application.created',
            aggregateType: 'application',
            aggregateId: created.id,
            payload: { applicationId: created.id, userId: user.id, jobId, status },
          });
          return created;
        });
        return { application: toApplicationSummary(application), created: true };
      } catch (err) {
        if (err.code !== 'P2002') throw err;
        // Lost a race with a concurrent request for the same job.
        const winner = await prisma.application.findUnique({ where: { userId_jobId: { userId: user.id, jobId } } });
        return { application: toApplicationSummary(winner), created: false };
      }
    },

    async list(user, query) {
      const base = { userId: user.id, deletedAt: null };
      const search = query.q
        ? {
            OR: [
              { job: { title: { contains: query.q, mode: 'insensitive' } } },
              { job: { company: { name: { contains: query.q, mode: 'insensitive' } } } },
            ],
          }
        : {};
      const where = { ...base, ...search, ...(query.status && { status: { in: query.status } }) };
      const offset = decodeCursor(query.cursor);

      const [applications, total, grouped] = await Promise.all([
        prisma.application.findMany({
          where,
          include: { job: JOB_SUMMARY },
          orderBy: SORTS[query.sort],
          skip: offset,
          take: query.limit,
        }),
        prisma.application.count({ where }),
        prisma.application.groupBy({ by: ['status'], where: { ...base, ...search }, _count: { _all: true } }),
      ]);

      const counts = Object.fromEntries(Object.values(S).map((status) => [status, 0]));
      for (const row of grouped) counts[row.status] = row._count._all;

      return {
        data: applications.map(toApplicationSummary),
        meta: { total, counts, nextCursor: nextCursor(offset, query.limit, total) },
      };
    },

    get: loadDetail,

    async update(user, id, changes, req) {
      const current = await findOwned(user, id);
      if (changes.resumeId !== undefined) await assertOwnResume(user, changes.resumeId);

      await prisma.$transaction([
        prisma.application.update({ where: { id }, data: changes }),
        recordAudit(prisma, {
          actorId: user.id,
          action: changes.resumeId !== undefined && changes.resumeId !== current.resumeId ? 'application.resume_attached' : 'application.updated',
          entityType: 'application',
          entityId: id,
          metadata: { fields: Object.keys(changes), ...(changes.resumeId !== undefined && { resumeId: changes.resumeId }) },
          req,
        }),
      ]);
      return loadDetail(user, id);
    },

    /**
     * Moves an application through the state machine. Uses the `version`
     * column as an optimistic lock so two tabs can't race into a bad state.
     */
    async changeStatus(user, id, { status: to, note, occurredAt = new Date(), expectedVersion }, req) {
      const current = await findOwned(user, id);
      const from = current.status;

      if (expectedVersion !== undefined && expectedVersion !== current.version) {
        throw conflict('VERSION_CONFLICT', 'This application changed since you loaded it. Refresh and try again.', {
          currentVersion: current.version,
          currentStatus: from,
        });
      }
      if (!canTransition(from, to)) {
        throw conflict('INVALID_TRANSITION', `Cannot move application from ${from} to ${to}`, {
          allowed: allowedTransitions(from),
        });
      }

      await prisma.$transaction(async (tx) => {
        const { count } = await tx.application.updateMany({
          where: { id, version: current.version, deletedAt: null },
          data: {
            status: to,
            version: { increment: 1 },
            statusChangedAt: new Date(),
            ...(to === S.APPLIED && !current.appliedAt && { appliedAt: occurredAt }),
          },
        });
        if (count === 0) {
          throw conflict('VERSION_CONFLICT', 'This application changed since you loaded it. Refresh and try again.');
        }
        await tx.applicationEvent.create({
          data: { applicationId: id, actorId: user.id, fromStatus: from, toStatus: to, note: note || null, occurredAt },
        });
        await recordAudit(tx, {
          actorId: user.id,
          action: 'application.status_changed',
          entityType: 'application',
          entityId: id,
          metadata: { from, to },
          req,
        });
        await recordEvent(tx, {
          type: 'application.status_changed',
          aggregateType: 'application',
          aggregateId: id,
          payload: { applicationId: id, userId: user.id, jobId: current.jobId, from, to, occurredAt: occurredAt.toISOString() },
        });
      });

      return loadDetail(user, id);
    },

    async remove(user, id, req) {
      await findOwned(user, id);
      await prisma.$transaction([
        prisma.application.update({ where: { id }, data: { deletedAt: new Date() } }),
        recordAudit(prisma, { actorId: user.id, action: 'application.deleted', entityType: 'application', entityId: id, req }),
      ]);
    },

    async listPrep(user, id) {
      await findOwned(user, id);
      const items = await prisma.prepItem.findMany({
        where: { applicationId: id },
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      });
      return items.map(toPrepItem);
    },

    async addPrep(user, id, { topic }) {
      await findOwned(user, id);
      const last = await prisma.prepItem.findFirst({ where: { applicationId: id }, orderBy: { position: 'desc' } });
      try {
        const item = await prisma.prepItem.create({
          data: { applicationId: id, topic, position: (last?.position ?? -1) + 1 },
        });
        return toPrepItem(item);
      } catch (err) {
        if (err.code === 'P2002') throw conflict('CONFLICT', `"${topic}" is already on the list`);
        throw err;
      }
    },

    async updatePrep(user, id, itemId, changes) {
      await findOwned(user, id);
      const { count } = await prisma.prepItem.updateMany({ where: { id: itemId, applicationId: id }, data: changes }).catch((err) => {
        if (err.code === 'P2002') throw conflict('CONFLICT', `"${changes.topic}" is already on the list`);
        throw err;
      });
      if (count === 0) throw notFound('Prep item not found');
      return toPrepItem(await prisma.prepItem.findUnique({ where: { id: itemId } }));
    },

    async removePrep(user, id, itemId) {
      await findOwned(user, id);
      const { count } = await prisma.prepItem.deleteMany({ where: { id: itemId, applicationId: id } });
      if (count === 0) throw notFound('Prep item not found');
    },
  };
}
