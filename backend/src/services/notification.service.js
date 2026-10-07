import { notFound } from '../utils/errors.js';
import { decodeCursor, nextCursor } from '../utils/pagination.js';

const iso = (date) => date?.toISOString() ?? null;

/**
 * Inserts notifications, skipping any whose (userId, dedupeKey) already exists,
 * so retried or duplicated jobs never notify twice. Returns how many were new.
 */
export async function createNotifications(db, notifications) {
  if (notifications.length === 0) return 0;
  const { count } = await db.notification.createMany({ data: notifications, skipDuplicates: true });
  return count;
}

export function toNotificationDto(notification) {
  return {
    id: notification.id,
    type: notification.type,
    title: notification.title,
    body: notification.body,
    link: notification.link,
    readAt: iso(notification.readAt),
    createdAt: iso(notification.createdAt),
  };
}

export function createNotificationService({ prisma }) {
  return {
    async list(user, { unread, limit, cursor }) {
      const where = { userId: user.id, ...(unread && { readAt: null }) };
      const offset = decodeCursor(cursor);
      const [items, total, unreadCount] = await Promise.all([
        prisma.notification.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: offset, take: limit }),
        prisma.notification.count({ where }),
        prisma.notification.count({ where: { userId: user.id, readAt: null } }),
      ]);
      return {
        data: items.map(toNotificationDto),
        meta: { total, unread: unreadCount, nextCursor: nextCursor(offset, limit, total) },
      };
    },

    unreadCount(user) {
      return prisma.notification.count({ where: { userId: user.id, readAt: null } });
    },

    async markRead(user, id) {
      const { count } = await prisma.notification.updateMany({
        where: { id, userId: user.id, readAt: null },
        data: { readAt: new Date() },
      });
      const notification = await prisma.notification.findFirst({ where: { id, userId: user.id } });
      if (!notification) throw notFound('Notification not found');
      return { notification: toNotificationDto(notification), changed: count > 0 };
    },

    async markAllRead(user) {
      const { count } = await prisma.notification.updateMany({
        where: { userId: user.id, readAt: null },
        data: { readAt: new Date() },
      });
      return count;
    },
  };
}
