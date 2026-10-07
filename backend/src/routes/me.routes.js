import { Router } from 'express';
import { createMeController } from '../controllers/me.controller.js';
import { createUserService } from '../services/user.service.js';

export function meRoutes({ prisma }) {
  const controller = createMeController({ userService: createUserService({ prisma }) });
  const router = Router();

  router.get('/', controller.get);
  router.patch('/', controller.update);

  return router;
}
