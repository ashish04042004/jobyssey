import { Redis } from 'ioredis';
import { env } from './env.js';
import { logger } from './logger.js';

export function createRedis(name, options = {}) {
  const client = new Redis(env.REDIS_URL, {
    connectionName: `jobyssey:${name}`,
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    ...options,
  });

  client.on('error', (err) => logger.warn({ err, redis: name }, 'redis error'));
  client.on('ready', () => logger.debug({ redis: name }, 'redis ready'));

  return client;
}
