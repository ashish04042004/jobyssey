/**
 * Writes an audit row. Pass the transaction client when the audit entry must
 * commit or roll back together with the business change.
 */
export function recordAudit(db, { actorId = null, action, entityType, entityId = null, metadata = {}, req }) {
  return db.auditLog.create({
    data: {
      actorId,
      action,
      entityType,
      entityId,
      metadata,
      ip: req?.ip ?? null,
      requestId: req?.id ?? null,
    },
  });
}
