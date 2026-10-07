import pkg from '../package.json' with { type: 'json' };
import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { createRedis } from './config/redis.js';
import { prisma } from './models/prisma.js';
import { createHealthService } from './services/health.service.js';
import { startWorkerRuntime } from './workers/index.js';
import { registerShutdown } from './utils/shutdown.js';

const redis = createRedis('api');
const healthService = createHealthService({ prisma, redis });

const app = createApp({
  logger,
  corsOrigins: env.CORS_ORIGINS,
  prisma,
  redis,
  healthService,
  version: pkg.version,
});

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, env: env.NODE_ENV }, 'api listening');
});
server.keepAliveTimeout = 65_000;

const workerRuntime = env.RUN_WORKER_IN_API
  ? await startWorkerRuntime({ prisma, redis, logger, redisUrl: env.REDIS_URL })
  : null;

registerShutdown(logger, [
  ['http', () => new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())))],
  ['worker', () => workerRuntime?.stop()],
  ['redis', () => redis.quit()],
  ['prisma', () => prisma.$disconnect()],
]);
