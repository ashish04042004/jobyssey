import { createHash, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';

const digest = (value) => createHash('sha256').update(value).digest();

/**
 * Behind the Cloudflare Pages `/api` proxy every request reaches the API from a
 * Cloudflare egress address, which would put all visitors in one rate-limit
 * bucket. The proxy forwards the visitor's address in `X-Client-IP` together
 * with a shared secret; only when the secret matches is that address used as
 * `req.ip`. Without a configured secret the header is ignored entirely.
 */
export function trustedProxy(secret) {
  if (!secret) return (req, res, next) => next();
  const expected = digest(secret);

  return (req, res, next) => {
    const presented = req.get('x-proxy-secret');
    const clientIp = req.get('x-client-ip')?.trim();
    if (presented && clientIp && isIP(clientIp) && timingSafeEqual(digest(presented), expected)) {
      Object.defineProperty(req, 'ip', { value: clientIp, configurable: true, enumerable: true });
    }
    next();
  };
}
