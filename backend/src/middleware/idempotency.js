import { createHash } from 'node:crypto';
import { AppError, badRequest, conflict } from '../utils/errors.js';

const TTL_MS = 24 * 60 * 60 * 1000;
// An IN_PROGRESS row older than this belongs to a request that died mid-way.
const LOCK_MS = 30_000;
const KEY_PATTERN = /^[A-Za-z0-9_.:-]{8,200}$/;

/** JSON with sorted keys, so `{a,b}` and `{b,a}` hash the same. */
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

const hashRequest = (req, path) => createHash('sha256').update(`${req.method} ${path} ${canonical(req.body)}`).digest('hex');

/**
 * Makes a mutating endpoint safe to retry (docs/api.md §2.4). Opt-in per
 * request via the `Idempotency-Key` header; scoped per user. Responses below
 * 500 are stored for 24 h and replayed; 5xx responses release the key so the
 * client can retry. Must run after `authenticate`.
 */
export function idempotent({ prisma }) {
  return async function idempotencyMiddleware(req, res, next) {
    const key = req.get('Idempotency-Key');
    if (!key) return next();
    if (!KEY_PATTERN.test(key)) {
      throw badRequest('Invalid Idempotency-Key', [{ path: 'Idempotency-Key', message: 'Use 8–200 letters, digits, or - _ . :' }]);
    }

    const userId = req.user.id;
    const path = `${req.baseUrl}${req.path}`.replace(/\/+$/, '');
    const requestHash = hashRequest(req, path);
    const now = new Date();

    const record = await claim(prisma, { userId, key, method: req.method, path, requestHash, now });
    if (record.replay) {
      res.set('Idempotent-Replayed', 'true');
      return res.status(record.replay.responseCode).json(record.replay.responseBody);
    }

    let settled = false;
    const send = res.json.bind(res);
    res.json = (body) => {
      settled = true;
      const store =
        res.statusCode < 500
          ? prisma.idempotencyKey.update({
              where: { id: record.id },
              data: { status: 'COMPLETED', responseCode: res.statusCode, responseBody: body ?? null },
            })
          : prisma.idempotencyKey.delete({ where: { id: record.id } });
      store
        .catch((err) => req.log?.error({ err }, 'could not store idempotent response'))
        .finally(() => send(body));
      return res;
    };
    res.on('close', () => {
      if (!settled) prisma.idempotencyKey.deleteMany({ where: { id: record.id, status: 'IN_PROGRESS' } }).catch(() => {});
    });

    next();
  };
}

async function claim(prisma, { userId, key, method, path, requestHash, now }) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await prisma.idempotencyKey.create({
        data: { userId, key, method, path, requestHash, lockedAt: now, expiresAt: new Date(now.getTime() + TTL_MS) },
      });
    } catch (err) {
      if (err.code !== 'P2002') throw err;
    }

    const existing = await prisma.idempotencyKey.findUnique({ where: { userId_key: { userId, key } } });
    if (!existing) continue;
    if (existing.expiresAt <= now) {
      await prisma.idempotencyKey.deleteMany({ where: { id: existing.id, expiresAt: { lte: now } } });
      continue;
    }
    if (existing.requestHash !== requestHash || existing.method !== method || existing.path !== path) {
      throw new AppError(422, 'IDEMPOTENCY_KEY_REUSED', 'This Idempotency-Key was already used for a different request');
    }
    if (existing.status === 'COMPLETED') return { replay: existing };

    if (now - existing.lockedAt < LOCK_MS) {
      throw conflict('IDEMPOTENCY_IN_PROGRESS', 'The original request with this Idempotency-Key is still being processed');
    }
    // The first attempt died without answering: take over its lock.
    const { count } = await prisma.idempotencyKey.updateMany({
      where: { id: existing.id, status: 'IN_PROGRESS', lockedAt: existing.lockedAt },
      data: { lockedAt: now },
    });
    if (count === 1) return existing;
    throw conflict('IDEMPOTENCY_IN_PROGRESS', 'The original request with this Idempotency-Key is still being processed');
  }
  throw conflict('IDEMPOTENCY_IN_PROGRESS', 'The original request with this Idempotency-Key is still being processed');
}
