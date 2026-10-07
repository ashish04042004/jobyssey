import { WORKER_HEARTBEAT_KEY } from '../workers/heartbeat.js';

const CHECK_TIMEOUT_MS = 2_000;

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function timed(fn) {
  const started = performance.now();
  try {
    await withTimeout(fn(), CHECK_TIMEOUT_MS);
    return { status: 'ok', latencyMs: Math.round(performance.now() - started) };
  } catch (err) {
    return { status: 'error', error: err.message };
  }
}

export function createHealthService({ prisma, redis }) {
  return {
    async readiness() {
      const [database, redisCheck, worker] = await Promise.all([
        timed(() => prisma.$queryRaw`SELECT 1`),
        timed(() => redis.ping()),
        redis
          .get(WORKER_HEARTBEAT_KEY)
          .then((raw) => {
            if (!raw) return { status: 'degraded', error: 'no recent heartbeat' };
            const { at } = JSON.parse(raw);
            return { status: 'ok', lastHeartbeatAt: at };
          })
          .catch(() => ({ status: 'degraded', error: 'heartbeat unavailable' })),
      ]);

      const checks = { database, redis: redisCheck, worker };
      const critical = [database, redisCheck];
      const status = critical.every((check) => check.status === 'ok') ? 'ok' : 'error';
      return { status, checks };
    },
  };
}
