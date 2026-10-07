import { ApplicationStatus } from '../domain/applicationStatus.js';
import { notFound } from '../utils/errors.js';
import { recordAudit } from './audit.service.js';
import { recordEvent } from './outbox.service.js';

export function toApplicationSummary(application) {
  return {
    id: application.id,
    jobId: application.jobId,
    status: application.status,
    appliedAt: application.appliedAt?.toISOString() ?? null,
    createdAt: application.createdAt.toISOString(),
    updatedAt: application.updatedAt.toISOString(),
  };
}

export function createApplicationService({ prisma, jobService }) {
  async function createSaved(tx, user, jobId, req) {
    const application = await tx.application.create({
      data: { userId: user.id, jobId, status: ApplicationStatus.SAVED },
    });
    await tx.applicationEvent.create({
      data: { applicationId: application.id, actorId: user.id, fromStatus: null, toStatus: ApplicationStatus.SAVED },
    });
    await recordAudit(tx, {
      actorId: user.id,
      action: 'application.created',
      entityType: 'application',
      entityId: application.id,
      metadata: { jobId, status: ApplicationStatus.SAVED },
      req,
    });
    await recordEvent(tx, {
      type: 'application.created',
      aggregateType: 'application',
      aggregateId: application.id,
      payload: { applicationId: application.id, userId: user.id, jobId, status: ApplicationStatus.SAVED },
    });
    return application;
  }

  return {
    /**
     * Idempotent "save job": returns `{ created: false }` with the existing
     * application if the user already tracks this job.
     */
    async saveJob(user, jobId, req) {
      const job = await jobService.findVisible(user, jobId);
      if (!job.isActive) throw notFound('Job not found');

      const existing = await prisma.application.findUnique({ where: { userId_jobId: { userId: user.id, jobId } } });
      if (existing && !existing.deletedAt) return { application: toApplicationSummary(existing), created: false };

      try {
        const application = await prisma.$transaction(async (tx) => {
          if (existing) {
            // Previously removed from the tracker: start over as a fresh save.
            // Its timeline cascades away; the audit log keeps the history.
            await tx.application.delete({ where: { id: existing.id } });
          }
          return createSaved(tx, user, jobId, req);
        });
        return { application: toApplicationSummary(application), created: true };
      } catch (err) {
        if (err.code !== 'P2002') throw err;
        // Lost a race with a concurrent save of the same job.
        const winner = await prisma.application.findUnique({ where: { userId_jobId: { userId: user.id, jobId } } });
        return { application: toApplicationSummary(winner), created: false };
      }
    },
  };
}
