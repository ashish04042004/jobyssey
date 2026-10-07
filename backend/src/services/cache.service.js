import { createHash } from 'node:crypto';

const PREFIX = 'jobyssey:cache';

/** Stable hash of a plain object, independent of key order. */
export function hashKey(value) {
  const canonical = JSON.stringify(value, (key, val) =>
    val && typeof val === 'object' && !Array.isArray(val)
      ? Object.fromEntries(Object.entries(val).sort(([a], [b]) => a.localeCompare(b)))
      : val,
  );
  return createHash('sha1').update(canonical).digest('hex').slice(0, 16);
}

/**
 * Cache-aside helper. Redis failures degrade to "always miss" so an outage
 * slows requests down instead of breaking them.
 */
export function createCache({ redis, logger }) {
  const warn = (err, op) => logger?.warn({ err, op }, 'cache unavailable');

  return {
    async remember(key, ttlSeconds, loader) {
      const fullKey = `${PREFIX}:${key}`;
      try {
        const hit = await redis.get(fullKey);
        if (hit !== null) return JSON.parse(hit);
      } catch (err) {
        warn(err, 'get');
      }

      const value = await loader();
      redis.set(fullKey, JSON.stringify(value), 'EX', ttlSeconds).catch((err) => warn(err, 'set'));
      return value;
    },

    /** Namespace version: bump it to invalidate every key built from it. */
    async version(namespace) {
      try {
        return Number(await redis.get(`${PREFIX}:${namespace}:version`)) || 0;
      } catch (err) {
        warn(err, 'version');
        return `nocache-${Date.now()}`;
      }
    },

    async bump(namespace) {
      try {
        await redis.incr(`${PREFIX}:${namespace}:version`);
      } catch (err) {
        warn(err, 'bump');
      }
    },
  };
}
