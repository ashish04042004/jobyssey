import { z } from 'zod';
import { notFound } from '../utils/errors.js';

const listQuery = z.object({
  unread: z.enum(['true', 'false']).optional().transform((v) => v === 'true'),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().max(200).optional(),
});

const idParam = z.object({ id: z.uuid() });

export function createNotificationController({ notificationService }) {
  return {
    async list(req, res) {
      res.json(await notificationService.list(req.user, listQuery.parse(req.query)));
    },

    async unreadCount(req, res) {
      res.json({ data: { count: await notificationService.unreadCount(req.user) } });
    },

    async markAllRead(req, res) {
      res.json({ data: { updated: await notificationService.markAllRead(req.user) } });
    },

    async markRead(req, res) {
      const parsed = idParam.safeParse(req.params);
      if (!parsed.success) throw notFound('Notification not found');
      const { notification } = await notificationService.markRead(req.user, parsed.data.id);
      res.json({ data: notification });
    },
  };
}
