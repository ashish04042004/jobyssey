import { AppError } from '../utils/errors.js';

// INCR + EXPIRE must be atomic, otherwise a crash between them leaves a key
// that never expires and locks the caller out forever.
const FIXED_WINDOW = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return { count, redis.call('TTL', KEYS[1]) }
`;

/**
 * Fixed-window rate limiter backed by Redis.
 *
 * @param {object} opts
 * @param {string} opts.name      namespace for the counter keys
 * @param {number} opts.limit     max requests per window
 * @param {number} opts.windowSec window length in seconds
 * @param {(req) => string} opts.key  identity being limited (ip, user id, ...)
 * @param {boolean} [opts.failClosed] reject requests when Redis is unavailable
 */
export function rateLimit({ redis, name, limit, windowSec, key, failClosed = false }) {
  return async function rateLimitMiddleware(req, res, next) {
    const redisKey = `jobyssey:rl:${name}:${key(req)}`;

    let count;
    let ttl;
    try {
      [count, ttl] = await redis.eval(FIXED_WINDOW, 1, redisKey, windowSec);
    } catch (err) {
      req.log?.warn({ err, limiter: name }, 'rate limiter unavailable');
      if (failClosed) {
        throw new AppError(503, 'UNAVAILABLE', 'Service temporarily unavailable, please retry shortly');
      }
      return next();
    }

    const reset = ttl > 0 ? ttl : windowSec;
    res.set({
      'RateLimit-Limit': String(limit),
      'RateLimit-Remaining': String(Math.max(0, limit - count)),
      'RateLimit-Reset': String(reset),
    });

    if (count > limit) {
      res.set('Retry-After', String(reset));
      throw new AppError(429, 'RATE_LIMITED', 'Too many requests, please slow down', { retryAfterSeconds: reset });
    }
    next();
  };
}
