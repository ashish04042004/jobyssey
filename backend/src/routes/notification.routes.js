import { Router } from 'express';
import { createNotificationController } from '../controllers/notification.controller.js';

export function notificationRoutes({ notificationService }) {
  const controller = createNotificationController({ notificationService });
  const router = Router();

  router.get('/', controller.list);
  router.get('/unread-count', controller.unreadCount);
  router.patch('/read-all', controller.markAllRead);
  router.patch('/:id/read', controller.markRead);

  return router;
}
