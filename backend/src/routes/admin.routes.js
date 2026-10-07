import { Router } from 'express';
import { createAdminController } from '../controllers/admin.controller.js';
import { requireRole } from '../middleware/authorize.js';

export function adminRoutes({ adminService }) {
  const controller = createAdminController({ adminService });
  const router = Router();

  router.use(requireRole('ADMIN'));
  router.get('/metrics', controller.metrics);
  router.get('/queues/:queue/failed', controller.failedJobs);
  router.post('/queues/:queue/jobs/:jobId/retry', controller.retryJob);

  return router;
}
