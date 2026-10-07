import { z } from 'zod';
import { notFound } from '../utils/errors.js';
import { listDocumentsQuery, updateDocumentSchema, uploadRequestSchema } from '../validators/document.validators.js';

const idParam = z.object({ id: z.uuid() });

function documentId(req) {
  const parsed = idParam.safeParse(req.params);
  if (!parsed.success) throw notFound('Document not found');
  return parsed.data.id;
}

export function createDocumentController({ documentService }) {
  return {
    async requestUpload(req, res) {
      res.status(201).json({ data: await documentService.requestUpload(req.user, uploadRequestSchema.parse(req.body), req) });
    },

    async complete(req, res) {
      res.json({ data: await documentService.complete(req.user, documentId(req), req) });
    },

    async list(req, res) {
      res.json(await documentService.list(req.user, listDocumentsQuery.parse(req.query)));
    },

    async update(req, res) {
      res.json({ data: await documentService.update(req.user, documentId(req), updateDocumentSchema.parse(req.body), req) });
    },

    async downloadUrl(req, res) {
      res.json({ data: await documentService.downloadUrl(req.user, documentId(req)) });
    },

    async remove(req, res) {
      await documentService.remove(req.user, documentId(req), req);
      res.status(204).end();
    },
  };
}
