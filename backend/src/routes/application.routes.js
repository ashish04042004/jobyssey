import { Router } from 'express';
import { createApplicationController } from '../controllers/application.controller.js';
import { rateLimit } from '../middleware/rateLimit.js';

export function applicationRoutes({ redis, applicationService }) {
  const controller = createApplicationController({ applicationService });
  const router = Router();
  const createLimit = rateLimit({ redis, name: 'application-create', limit: 30, windowSec: 60, key: (req) => req.user.id });

  router.post('/', createLimit, controller.create);
  router.get('/', controller.list);
  router.get('/:id', controller.get);
  router.patch('/:id', controller.update);
  router.patch('/:id/status', controller.changeStatus);
  router.delete('/:id', controller.remove);

  router.get('/:id/prep', controller.listPrep);
  router.post('/:id/prep', controller.addPrep);
  router.patch('/:id/prep/:itemId', controller.updatePrep);
  router.delete('/:id/prep/:itemId', controller.removePrep);

  return router;
}
