import { env } from '../config/env.js';
import { loginSchema, registerSchema } from '../validators/auth.validators.js';

export const REFRESH_COOKIE = 'jobyssey_rt';

const cookieOptions = () => ({
  httpOnly: true,
  secure: env.COOKIE_SECURE,
  sameSite: env.COOKIE_SAMESITE,
  path: '/api/auth',
});

function setRefreshCookie(res, token) {
  res.cookie(REFRESH_COOKIE, token, { ...cookieOptions(), maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000 });
}

export function createAuthController({ authService }) {
  return {
    async register(req, res) {
      const input = registerSchema.parse(req.body);
      const { user, accessToken, refreshToken } = await authService.register(input, req);
      setRefreshCookie(res, refreshToken);
      res.status(201).json({ data: { user, accessToken } });
    },

    async login(req, res) {
      const input = loginSchema.parse(req.body);
      const { user, accessToken, refreshToken } = await authService.login(input, req);
      setRefreshCookie(res, refreshToken);
      res.json({ data: { user, accessToken } });
    },

    async refresh(req, res) {
      try {
        const { accessToken, refreshToken } = await authService.refresh(req.cookies?.[REFRESH_COOKIE], req);
        if (refreshToken) setRefreshCookie(res, refreshToken);
        res.json({ data: { accessToken } });
      } catch (err) {
        res.clearCookie(REFRESH_COOKIE, cookieOptions());
        throw err;
      }
    },

    async logout(req, res) {
      await authService.logout(req.cookies?.[REFRESH_COOKIE], req);
      res.clearCookie(REFRESH_COOKIE, cookieOptions());
      res.status(204).end();
    },
  };
}
