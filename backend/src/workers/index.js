import { startHeartbeat } from './heartbeat.js';

/**
 * Starts every background processor. Used by the standalone worker process and,
 * when RUN_WORKER_IN_API=true, inside the API process for single-instance hosting.
 */
export function startWorkerRuntime({ redis, logger }) {
  const heartbeat = startHeartbeat(redis, logger);
  logger.info({ workerId: heartbeat.workerId }, 'worker runtime started');

  return {
    async stop() {
      heartbeat.stop();
    },
  };
}
