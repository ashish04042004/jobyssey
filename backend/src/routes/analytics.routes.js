import { Router } from 'express';
import { createAnalyticsController } from '../controllers/analytics.controller.js';

export function analyticsRoutes({ analyticsService }) {
  const controller = createAnalyticsController({ analyticsService });
  const router = Router();

  router.get('/dashboard', controller.dashboard);
  router.get('/applications', controller.applications);

  return router;
}
