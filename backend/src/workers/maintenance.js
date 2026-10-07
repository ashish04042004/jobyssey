const DAY_MS = 24 * 60 * 60 * 1000;

export const RETENTION = Object.freeze({
  publishedOutboxDays: 7,
  expiredRefreshTokenDays: 7,
});

/**
 * Deletes rows that only exist for short-term bookkeeping. Each statement is a
 * plain range delete, so overlapping or repeated runs are harmless.
 */
export async function pruneStorage({ prisma, logger }, now = new Date()) {
  const daysAgo = (days) => new Date(now.getTime() - days * DAY_MS);

  const [idempotencyKeys, outboxEvents, refreshTokens] = await Promise.all([
    prisma.idempotencyKey.deleteMany({ where: { expiresAt: { lte: now } } }),
    prisma.outboxEvent.deleteMany({ where: { publishedAt: { lte: daysAgo(RETENTION.publishedOutboxDays) } } }),
    prisma.refreshToken.deleteMany({ where: { expiresAt: { lte: daysAgo(RETENTION.expiredRefreshTokenDays) } } }),
  ]);

  const pruned = { idempotencyKeys: idempotencyKeys.count, outboxEvents: outboxEvents.count, refreshTokens: refreshTokens.count };
  logger?.info({ pruned }, 'maintenance prune finished');
  return pruned;
}
