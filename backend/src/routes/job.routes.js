import { Router } from 'express';
import { createJobController } from '../controllers/job.controller.js';
import { idempotent } from '../middleware/idempotency.js';
import { rateLimit } from '../middleware/rateLimit.js';

export function jobRoutes({ redis, prisma, jobService, applicationService }) {
  const controller = createJobController({ jobService, applicationService });
  const router = Router();
  const writeLimit = rateLimit({ redis, name: 'job-write', limit: 30, windowSec: 60, key: (req) => req.user.id });
  const idem = idempotent({ prisma });

  router.get('/', controller.list);
  router.post('/', writeLimit, idem, controller.create);
  router.get('/:id', controller.get);
  router.patch('/:id', writeLimit, controller.update);
  router.delete('/:id', writeLimit, controller.archive);
  router.post('/:id/save', writeLimit, idem, controller.save);

  return router;
}
