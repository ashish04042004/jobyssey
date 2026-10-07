const BATCH_SIZE = 100;

/**
 * Publishes one batch of unpublished outbox events to the `domain-events`
 * queue. `FOR UPDATE SKIP LOCKED` lets several workers relay concurrently
 * without taking the same rows; jobId = event id makes a re-publish after a
 * crash (enqueued but not yet marked) a no-op. Returns the number relayed.
 */
export async function relayOutboxBatch({ prisma, queues }, batchSize = BATCH_SIZE) {
  return prisma.$transaction(async (tx) => {
    const events = await tx.$queryRaw`
      SELECT id, type, aggregate_type AS "aggregateType", aggregate_id AS "aggregateId", payload, created_at AS "createdAt"
      FROM outbox_events
      WHERE published_at IS NULL
      ORDER BY created_at
      LIMIT ${batchSize}
      FOR UPDATE SKIP LOCKED`;
    if (events.length === 0) return 0;

    await queues.events.addBulk(
      events.map((event) => ({
        name: event.type,
        data: {
          eventId: event.id,
          type: event.type,
          aggregateType: event.aggregateType,
          aggregateId: event.aggregateId,
          payload: event.payload,
          occurredAt: event.createdAt.toISOString(),
        },
        opts: { jobId: event.id },
      })),
    );
    await tx.outboxEvent.updateMany({
      where: { id: { in: events.map((event) => event.id) } },
      data: { publishedAt: new Date(), attempts: { increment: 1 } },
    });
    return events.length;
  });
}

/** Polls the outbox; drains back-to-back while full batches keep coming. */
export function startOutboxRelay(deps, { intervalMs = 1_000 } = {}) {
  let stopped = false;
  let timer = null;
  let running = Promise.resolve();

  const tick = async () => {
    if (stopped) return;
    let relayed = 0;
    try {
      relayed = await relayOutboxBatch(deps);
    } catch (err) {
      deps.logger.error({ err }, 'outbox relay failed');
    }
    if (!stopped) timer = setTimeout(() => (running = tick()), relayed === BATCH_SIZE ? 0 : intervalMs);
  };
  running = tick();

  return {
    async stop() {
      stopped = true;
      clearTimeout(timer);
      await running;
    },
  };
}
