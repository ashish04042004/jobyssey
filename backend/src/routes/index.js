import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { authRoutes } from './auth.routes.js';
import { healthRoutes } from './health.routes.js';
import { meRoutes } from './me.routes.js';

export function apiRoutes(deps) {
  const router = Router();
  const protectedRoute = [
    authenticate,
    rateLimit({ redis: deps.redis, name: 'api', limit: 100, windowSec: 60, key: (req) => req.user.id }),
  ];

  router.use('/health', healthRoutes(deps));
  router.use('/auth', authRoutes(deps));
  router.use('/me', ...protectedRoute, meRoutes(deps));

  return router;
}
