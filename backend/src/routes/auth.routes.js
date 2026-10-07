import { Router } from 'express';
import { createAuthController } from '../controllers/auth.controller.js';
import { requireAllowedOrigin } from '../middleware/originCheck.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { createAuthService } from '../services/auth.service.js';

export function authRoutes({ prisma, redis, corsOrigins }) {
  const controller = createAuthController({ authService: createAuthService({ prisma }) });
  const router = Router();

  const registerLimit = rateLimit({
    redis,
    name: 'register',
    limit: 5,
    windowSec: 60 * 60,
    key: (req) => req.ip,
  });
  const loginLimit = rateLimit({
    redis,
    name: 'login',
    limit: 5,
    windowSec: 60,
    key: (req) => `${req.ip}:${String(req.body?.email ?? '').trim().toLowerCase()}`,
    failClosed: true,
  });
  const refreshLimit = rateLimit({ redis, name: 'refresh', limit: 30, windowSec: 60, key: (req) => req.ip });
  const sameSite = requireAllowedOrigin(corsOrigins);

  router.post('/register', registerLimit, controller.register);
  router.post('/login', loginLimit, controller.login);
  router.post('/refresh', sameSite, refreshLimit, controller.refresh);
  router.post('/logout', sameSite, controller.logout);

  return router;
}
