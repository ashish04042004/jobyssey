import { badRequest, notFound } from '../utils/errors.js';
import { decodeCursor, nextCursor } from '../utils/pagination.js';
import { JOB_SUMMARY, toJobSummary } from './application.service.js';
import { recordAudit } from './audit.service.js';
import { recordEvent } from './outbox.service.js';
import { cancelReminders, syncReminders } from './reminder.service.js';

const ENTITY = 'interview';
const iso = (date) => date?.toISOString() ?? null;

const WITH_APPLICATION = {
  application: { select: { id: true, status: true, job: JOB_SUMMARY } },
};

export function toInterviewDto(interview, reminders) {
  return {
    id: interview.id,
    applicationId: interview.applicationId,
    type: interview.type,
    title: interview.title,
    scheduledAt: iso(interview.scheduledAt),
    endsAt: iso(interview.endsAt),
    meetingUrl: interview.meetingUrl,
    notes: interview.notes,
    status: interview.status,
    reminderOffsetsMinutes: interview.reminderOffsetsMinutes,
    createdAt: iso(interview.createdAt),
    updatedAt: iso(interview.updatedAt),
    ...(interview.application && {
      application: {
        id: interview.application.id,
        status: interview.application.status,
        job: toJobSummary(interview.application.job),
      },
    }),
    ...(reminders && {
      reminders: reminders.map((r) => ({ id: r.id, remindAt: iso(r.remindAt), status: r.status })),
    }),
  };
}

function syncFor(tx, interview) {
  return syncReminders(tx, {
    userId: interview.userId,
    entityType: ENTITY,
    entityId: interview.id,
    targetAt: interview.scheduledAt,
    offsetsMinutes: interview.reminderOffsetsMinutes,
    active: interview.status === 'SCHEDULED',
  });
}

function eventFor(before, after) {
  if (after.status !== before.status) {
    if (after.status === 'CANCELLED') return 'interview.cancelled';
    if (after.status === 'COMPLETED') return 'interview.completed';
    return 'interview.scheduled';
  }
  if (after.scheduledAt.getTime() !== before.scheduledAt.getTime()) return 'interview.rescheduled';
  return null;
}

export function createInterviewService({ prisma }) {
  const visible = (user) => ({ userId: user.id, application: { deletedAt: null } });

  async function findOwned(user, id) {
    const interview = await prisma.interview.findFirst({ where: { id, ...visible(user) } });
    if (!interview) throw notFound('Interview not found');
    return interview;
  }

  async function loadDetail(user, id) {
    const [interview, reminders] = await Promise.all([
      prisma.interview.findFirst({ where: { id, ...visible(user) }, include: WITH_APPLICATION }),
      prisma.reminder.findMany({
        where: { entityType: ENTITY, entityId: id, status: { not: 'CANCELLED' } },
        orderBy: { remindAt: 'asc' },
      }),
    ]);
    if (!interview) throw notFound('Interview not found');
    return toInterviewDto(interview, reminders);
  }

  return {
    async schedule(user, applicationId, body, req) {
      const application = await prisma.application.findFirst({
        where: { id: applicationId, userId: user.id, deletedAt: null },
      });
      if (!application) throw notFound('Application not found');

      const interview = await prisma.$transaction(async (tx) => {
        const created = await tx.interview.create({ data: { ...body, applicationId, userId: user.id } });
        await syncFor(tx, created);
        await recordAudit(tx, {
          actorId: user.id,
          action: 'interview.scheduled',
          entityType: ENTITY,
          entityId: created.id,
          metadata: { applicationId, type: created.type, scheduledAt: iso(created.scheduledAt) },
          req,
        });
        await recordEvent(tx, {
          type: 'interview.scheduled',
          aggregateType: ENTITY,
          aggregateId: created.id,
          payload: { interviewId: created.id, applicationId, userId: user.id, scheduledAt: iso(created.scheduledAt) },
        });
        return created;
      });
      return loadDetail(user, interview.id);
    },

    async list(user, query) {
      const where = {
        ...visible(user),
        ...((query.from || query.to) && { scheduledAt: { gte: query.from, lte: query.to } }),
        ...(query.status && { status: { in: query.status } }),
      };
      const offset = decodeCursor(query.cursor);
      const [interviews, total] = await Promise.all([
        prisma.interview.findMany({
          where,
          include: WITH_APPLICATION,
          orderBy: [{ scheduledAt: query.order }, { createdAt: 'asc' }],
          skip: offset,
          take: query.limit,
        }),
        prisma.interview.count({ where }),
      ]);
      return {
        data: interviews.map((interview) => toInterviewDto(interview)),
        meta: { total, nextCursor: nextCursor(offset, query.limit, total) },
      };
    },

    get: loadDetail,

    async update(user, id, changes, req) {
      const before = await findOwned(user, id);
      const merged = { ...before, ...changes };
      if (merged.endsAt && merged.endsAt <= merged.scheduledAt) {
        throw badRequest('Invalid end time', [{ path: 'endsAt', message: 'Must be after the start time' }]);
      }

      await prisma.$transaction(async (tx) => {
        const after = await tx.interview.update({ where: { id }, data: changes });
        await syncFor(tx, after);
        await recordAudit(tx, {
          actorId: user.id,
          action: 'interview.updated',
          entityType: ENTITY,
          entityId: id,
          metadata: { fields: Object.keys(changes), ...(changes.status && { status: changes.status }) },
          req,
        });
        const type = eventFor(before, after);
        if (type) {
          await recordEvent(tx, {
            type,
            aggregateType: ENTITY,
            aggregateId: id,
            payload: { interviewId: id, applicationId: after.applicationId, userId: user.id, scheduledAt: iso(after.scheduledAt) },
          });
        }
      });
      return loadDetail(user, id);
    },

    async remove(user, id, req) {
      const interview = await findOwned(user, id);
      await prisma.$transaction([
        prisma.interview.delete({ where: { id } }),
        cancelReminders(prisma, ENTITY, [id]),
        recordAudit(prisma, {
          actorId: user.id,
          action: 'interview.deleted',
          entityType: ENTITY,
          entityId: id,
          metadata: { applicationId: interview.applicationId },
          req,
        }),
      ]);
    },

    /** Upcoming interviews plus deadlines for jobs saved but not yet applied to. */
    async agenda(user, { from, to }) {
      const [interviews, deadlines] = await Promise.all([
        prisma.interview.findMany({
          where: { ...visible(user), status: 'SCHEDULED', scheduledAt: { gte: from, lte: to } },
          include: WITH_APPLICATION,
        }),
        prisma.application.findMany({
          where: { userId: user.id, deletedAt: null, status: 'SAVED', job: { applicationDeadline: { gte: from, lte: to } } },
          include: { job: JOB_SUMMARY },
        }),
      ]);

      const items = [
        ...interviews.map((interview) => {
          const dto = toInterviewDto(interview);
          return {
            kind: interview.type === 'OA' ? 'OA' : 'INTERVIEW',
            at: dto.scheduledAt,
            interview: { id: dto.id, type: dto.type, title: dto.title, endsAt: dto.endsAt, meetingUrl: dto.meetingUrl },
            application: { id: dto.application.id, status: dto.application.status },
            job: dto.application.job,
          };
        }),
        ...deadlines.map((application) => ({
          kind: 'DEADLINE',
          at: iso(application.job.applicationDeadline),
          interview: null,
          application: { id: application.id, status: application.status },
          job: toJobSummary(application.job),
        })),
      ];
      items.sort((a, b) => a.at.localeCompare(b.at));
      return items;
    },
  };
}
