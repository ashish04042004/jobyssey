import { Router } from 'express';
import { createHealthController } from '../controllers/health.controller.js';

export function healthRoutes(deps) {
  const controller = createHealthController(deps);
  const router = Router();

  router.get('/', controller.liveness);
  router.get('/ready', controller.readiness);

  return router;
}
