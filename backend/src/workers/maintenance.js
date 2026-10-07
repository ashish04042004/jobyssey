const DAY_MS = 24 * 60 * 60 * 1000;

export const RETENTION = Object.freeze({
  publishedOutboxDays: 7,
  expiredRefreshTokenDays: 7,
  abandonedUploadDays: 1,
});

/** Uploads that never completed: drop the row and any partial object. */
async function pruneAbandonedUploads({ prisma, storage, logger }, before) {
  const stale = await prisma.document.findMany({
    where: { status: 'PENDING', createdAt: { lte: before } },
    select: { id: true, storageKey: true },
    take: 500,
  });
  for (const { storageKey } of stale) {
    await storage?.remove(storageKey).catch((err) => logger?.warn({ err, storageKey }, 'could not remove abandoned upload'));
  }
  const { count } = await prisma.document.deleteMany({ where: { id: { in: stale.map((d) => d.id) }, status: 'PENDING' } });
  return count;
}

/**
 * Deletes rows that only exist for short-term bookkeeping. Each statement is a
 * plain range delete, so overlapping or repeated runs are harmless.
 */
export async function pruneStorage(deps, now = new Date()) {
  const { prisma, logger } = deps;
  const daysAgo = (days) => new Date(now.getTime() - days * DAY_MS);

  const [idempotencyKeys, outboxEvents, refreshTokens, abandonedUploads] = await Promise.all([
    prisma.idempotencyKey.deleteMany({ where: { expiresAt: { lte: now } } }),
    prisma.outboxEvent.deleteMany({ where: { publishedAt: { lte: daysAgo(RETENTION.publishedOutboxDays) } } }),
    prisma.refreshToken.deleteMany({ where: { expiresAt: { lte: daysAgo(RETENTION.expiredRefreshTokenDays) } } }),
    pruneAbandonedUploads(deps, daysAgo(RETENTION.abandonedUploadDays)),
  ]);

  const pruned = {
    idempotencyKeys: idempotencyKeys.count,
    outboxEvents: outboxEvents.count,
    refreshTokens: refreshTokens.count,
    abandonedUploads,
  };
  logger?.info({ pruned }, 'maintenance prune finished');
  return pruned;
}
