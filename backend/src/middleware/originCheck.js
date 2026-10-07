import { forbidden } from '../utils/errors.js';

/**
 * CSRF guard for cookie-authenticated endpoints (refresh, logout): browsers
 * always send Origin on cross-origin POSTs, so reject any origin we don't serve.
 */
export function requireAllowedOrigin(allowedOrigins) {
  const allowed = new Set(allowedOrigins);
  return function originCheck(req, res, next) {
    const origin = req.get('origin');
    if (origin && !allowed.has(origin)) throw forbidden('Origin not allowed');
    next();
  };
}
