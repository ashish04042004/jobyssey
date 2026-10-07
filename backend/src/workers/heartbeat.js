import os from 'node:os';

export const WORKER_HEARTBEAT_KEY = 'jobyssey:worker:heartbeat';
const INTERVAL_MS = 15_000;
const TTL_SECONDS = 45;

export function startHeartbeat(redis, logger) {
  const workerId = `${os.hostname()}:${process.pid}`;

  const beat = async () => {
    try {
      const payload = JSON.stringify({ workerId, at: new Date().toISOString() });
      await redis.set(WORKER_HEARTBEAT_KEY, payload, 'EX', TTL_SECONDS);
    } catch (err) {
      logger.warn({ err }, 'worker heartbeat failed');
    }
  };

  beat();
  const timer = setInterval(beat, INTERVAL_MS);
  timer.unref();

  return { workerId, stop: () => clearInterval(timer) };
}
