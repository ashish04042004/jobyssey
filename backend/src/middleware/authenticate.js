import { unauthenticated } from '../utils/errors.js';
import { verifyAccessToken } from '../utils/tokens.js';

export async function authenticate(req, res, next) {
  const header = req.get('authorization') ?? '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) throw unauthenticated();

  try {
    req.user = await verifyAccessToken(token);
  } catch {
    throw unauthenticated('Access token is invalid or expired');
  }
  next();
}
