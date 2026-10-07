import { Router } from 'express';
import { createDocumentController } from '../controllers/document.controller.js';
import { rateLimit } from '../middleware/rateLimit.js';

export function documentRoutes({ redis, documentService }) {
  const controller = createDocumentController({ documentService });
  const router = Router();
  const uploadLimit = rateLimit({ redis, name: 'document-upload', limit: 20, windowSec: 60 * 60, key: (req) => req.user.id });

  router.get('/', controller.list);
  router.post('/upload-url', uploadLimit, controller.requestUpload);
  router.post('/:id/complete', controller.complete);
  router.patch('/:id', controller.update);
  router.get('/:id/download-url', controller.downloadUrl);
  router.delete('/:id', controller.remove);

  return router;
}
