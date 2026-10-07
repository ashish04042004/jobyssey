import { Router } from 'express';
import { createJobController } from '../controllers/job.controller.js';
import { rateLimit } from '../middleware/rateLimit.js';

export function jobRoutes({ redis, jobService, applicationService }) {
  const controller = createJobController({ jobService, applicationService });
  const router = Router();
  const writeLimit = rateLimit({ redis, name: 'job-write', limit: 30, windowSec: 60, key: (req) => req.user.id });

  router.get('/', controller.list);
  router.post('/', writeLimit, controller.create);
  router.get('/:id', controller.get);
  router.patch('/:id', writeLimit, controller.update);
  router.delete('/:id', writeLimit, controller.archive);
  router.post('/:id/save', writeLimit, controller.save);

  return router;
}
