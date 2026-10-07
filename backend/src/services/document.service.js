import { randomUUID } from 'node:crypto';
import { AppError, conflict, notFound } from '../utils/errors.js';
import { MAX_DOCUMENT_BYTES, MAX_DOCUMENTS_PER_USER, MIME_EXTENSIONS } from '../validators/document.validators.js';
import { recordAudit } from './audit.service.js';

const UPLOAD_URL_TTL_SEC = 15 * 60;
const DOWNLOAD_URL_TTL_SEC = 5 * 60;

export function toDocumentDto(document) {
  return {
    id: document.id,
    label: document.label,
    type: document.type,
    filename: document.filename,
    mimeType: document.mimeType,
    sizeBytes: document.sizeBytes,
    status: document.status,
    createdAt: document.createdAt.toISOString(),
    ...(document._count && { usedByApplications: document._count.applications }),
  };
}

const withUsage = { _count: { select: { applications: { where: { deletedAt: null } } } } };

/**
 * Documents live in object storage; Postgres keeps the metadata. Uploads are
 * two-phase: a PENDING row plus a signed upload URL, then `complete` checks the
 * object really landed before marking it READY.
 */
export function createDocumentService({ prisma, storage, logger }) {
  async function findOwned(user, id) {
    const document = await prisma.document.findFirst({ where: { id, userId: user.id, deletedAt: null } });
    if (!document) throw notFound('Document not found');
    return document;
  }

  return {
    async requestUpload(user, { label, type, filename, mimeType, sizeBytes }, req) {
      const count = await prisma.document.count({ where: { userId: user.id, deletedAt: null } });
      if (count >= MAX_DOCUMENTS_PER_USER) {
        throw conflict('DOCUMENT_LIMIT_REACHED', `You can keep up to ${MAX_DOCUMENTS_PER_USER} documents. Delete an old one first.`);
      }

      const storageKey = `users/${user.id}/${randomUUID()}.${MIME_EXTENSIONS[mimeType]}`;
      const document = await prisma.document.create({
        data: { userId: user.id, label, type, filename, mimeType, sizeBytes, storageKey },
      });
      const upload = await storage.createUploadUrl(storageKey, { mimeType, sizeBytes, expiresInSec: UPLOAD_URL_TTL_SEC });
      await recordAudit(prisma, { actorId: user.id, action: 'document.upload_requested', entityType: 'document', entityId: document.id, req });

      return {
        document: toDocumentDto(document),
        uploadUrl: upload.url,
        uploadMethod: upload.method,
        uploadHeaders: upload.headers,
        expiresAt: upload.expiresAt,
      };
    },

    /** Idempotent: completing a READY document returns it unchanged. */
    async complete(user, id, req) {
      const document = await findOwned(user, id);
      if (document.status === 'READY') return toDocumentDto(document);

      const object = await storage.stat(document.storageKey);
      if (!object) throw conflict('UPLOAD_MISSING', 'The file has not been uploaded yet');
      const actual = object.sizeBytes ?? document.sizeBytes;
      if (actual > MAX_DOCUMENT_BYTES) {
        await storage.remove(document.storageKey);
        await prisma.document.delete({ where: { id } });
        throw new AppError(413, 'FILE_TOO_LARGE', 'Files can be at most 5 MB');
      }

      const ready = await prisma.$transaction(async (tx) => {
        const updated = await tx.document.update({ where: { id }, data: { status: 'READY', sizeBytes: actual }, include: withUsage });
        await recordAudit(tx, {
          actorId: user.id,
          action: 'document.uploaded',
          entityType: 'document',
          entityId: id,
          metadata: { type: updated.type, sizeBytes: actual },
          req,
        });
        return updated;
      });
      return toDocumentDto(ready);
    },

    async list(user, { type }) {
      const documents = await prisma.document.findMany({
        where: { userId: user.id, deletedAt: null, status: 'READY', ...(type && { type }) },
        orderBy: { createdAt: 'desc' },
        include: withUsage,
      });
      return { data: documents.map(toDocumentDto), meta: { limit: MAX_DOCUMENTS_PER_USER, maxBytes: MAX_DOCUMENT_BYTES } };
    },

    async update(user, id, changes, req) {
      await findOwned(user, id);
      const updated = await prisma.document.update({ where: { id }, data: changes, include: withUsage });
      await recordAudit(prisma, { actorId: user.id, action: 'document.updated', entityType: 'document', entityId: id, metadata: { fields: Object.keys(changes) }, req });
      return toDocumentDto(updated);
    },

    async downloadUrl(user, id) {
      const document = await findOwned(user, id);
      if (document.status !== 'READY') throw conflict('UPLOAD_MISSING', 'The file has not been uploaded yet');
      const link = await storage.createDownloadUrl(document.storageKey, {
        filename: document.filename,
        mimeType: document.mimeType,
        expiresInSec: DOWNLOAD_URL_TTL_SEC,
      });
      return { url: link.url, expiresAt: link.expiresAt };
    },

    /**
     * Soft delete: applications that used this resume keep pointing at the row
     * (shown as "deleted"), but the file itself is removed from storage.
     */
    async remove(user, id, req) {
      const document = await findOwned(user, id);
      await prisma.$transaction(async (tx) => {
        await tx.document.update({ where: { id }, data: { deletedAt: new Date() } });
        await recordAudit(tx, { actorId: user.id, action: 'document.deleted', entityType: 'document', entityId: id, req });
      });
      await storage.remove(document.storageKey).catch((err) => logger?.warn({ err, id }, 'could not delete stored file'));
    },
  };
}
