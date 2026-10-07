import { logger } from './config/logger.js';
import { createRedis } from './config/redis.js';
import { prisma } from './models/prisma.js';
import { startWorkerRuntime } from './workers/index.js';
import { registerShutdown } from './utils/shutdown.js';

const redis = createRedis('worker');
const runtime = startWorkerRuntime({ redis, logger });

registerShutdown(logger, [
  ['worker', () => runtime.stop()],
  ['redis', () => redis.quit()],
  ['prisma', () => prisma.$disconnect()],
]);
