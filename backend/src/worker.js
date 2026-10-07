import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { createRedis } from './config/redis.js';
import { prisma } from './models/prisma.js';
import { createStorage } from './storage/index.js';
import { startWorkerRuntime } from './workers/index.js';
import { registerShutdown } from './utils/shutdown.js';

const redis = createRedis('worker');
const storage = createStorage(env);
const runtime = await startWorkerRuntime({ prisma, redis, logger, storage, redisUrl: env.REDIS_URL });

registerShutdown(logger, [
  ['worker', () => runtime.stop()],
  ['redis', () => redis.quit()],
  ['prisma', () => prisma.$disconnect()],
]);
