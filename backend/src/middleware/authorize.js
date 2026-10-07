import { forbidden, unauthenticated } from '../utils/errors.js';

export function requireRole(...roles) {
  return function requireRoleMiddleware(req, res, next) {
    if (!req.user) throw unauthenticated();
    if (!roles.includes(req.user.role)) throw forbidden();
    next();
  };
}
