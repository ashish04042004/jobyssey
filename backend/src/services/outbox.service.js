/**
 * Records a domain event in the same transaction as the change that caused it.
 * The worker's outbox relay publishes it to BullMQ (docs/architecture.md §5).
 */
export function recordEvent(tx, { type, aggregateType, aggregateId, payload = {} }) {
  return tx.outboxEvent.create({ data: { type, aggregateType, aggregateId, payload } });
}
