import { randomUUID } from 'node:crypto';
import { env } from '../config/env.js';
import { AppError, conflict, unauthenticated } from '../utils/errors.js';
import { burnPasswordCheck, hashPassword, verifyPassword } from '../utils/password.js';
import { generateRefreshToken, hashToken, signAccessToken } from '../utils/tokens.js';
import { recordAudit } from './audit.service.js';
import { toPublicUser } from './user.service.js';

const DAY_MS = 24 * 60 * 60 * 1000;

// Two tabs refreshing at the same moment both present the same cookie; the
// loser sees a token rotated milliseconds ago. Within this window that is
// treated as a race, not theft.
export const ROTATION_GRACE_MS = 30_000;

const invalidCredentials = () => new AppError(401, 'INVALID_CREDENTIALS', 'Incorrect email or password');
const invalidSession = () => unauthenticated('Session expired, please log in again');

function clientMeta(req) {
  return { userAgent: req.get('user-agent')?.slice(0, 255) ?? null, ip: req.ip ?? null };
}

export function createAuthService({ prisma }) {
  async function issueRefreshToken(db, userId, familyId, req) {
    const token = generateRefreshToken();
    const record = await db.refreshToken.create({
      data: {
        userId,
        familyId,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * DAY_MS),
        ...clientMeta(req),
      },
    });
    return { token, record };
  }

  async function startSession(db, user, req) {
    const { token: refreshToken } = await issueRefreshToken(db, user.id, randomUUID(), req);
    const accessToken = await signAccessToken(user);
    return { user: toPublicUser(user), accessToken, refreshToken };
  }

  async function revokeFamily(db, familyId) {
    await db.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  return {
    async register(input, req) {
      const passwordHash = await hashPassword(input.password);
      const { password: _password, ...profile } = input;

      try {
        return await prisma.$transaction(async (tx) => {
          const user = await tx.user.create({ data: { ...profile, passwordHash, lastLoginAt: new Date() } });
          await recordAudit(tx, { actorId: user.id, action: 'auth.register', entityType: 'user', entityId: user.id, req });
          return startSession(tx, user, req);
        });
      } catch (err) {
        if (err.code === 'P2002') throw conflict('CONFLICT', 'An account with this email already exists');
        throw err;
      }
    },

    async login({ email, password }, req) {
      const user = await prisma.user.findUnique({ where: { email } });
      if (!user) {
        await burnPasswordCheck(password);
        throw invalidCredentials();
      }

      if (!(await verifyPassword(user.passwordHash, password))) {
        await recordAudit(prisma, { actorId: user.id, action: 'auth.login_failed', entityType: 'user', entityId: user.id, req });
        throw invalidCredentials();
      }

      return prisma.$transaction(async (tx) => {
        const updated = await tx.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
        await recordAudit(tx, { actorId: user.id, action: 'auth.login', entityType: 'user', entityId: user.id, req });
        return startSession(tx, updated, req);
      });
    },

    /**
     * Rotates the refresh token. Returns `refreshToken: null` when the caller
     * lost a concurrent-rotation race and should keep its (already newer) cookie.
     */
    async refresh(presentedToken, req) {
      if (!presentedToken) throw invalidSession();

      const existing = await prisma.refreshToken.findUnique({
        where: { tokenHash: hashToken(presentedToken) },
        include: { user: true },
      });
      if (!existing) throw invalidSession();

      const now = Date.now();
      if (existing.expiresAt.getTime() <= now) throw invalidSession();

      if (existing.revokedAt) {
        const rotatedRecently = existing.replacedById && now - existing.revokedAt.getTime() < ROTATION_GRACE_MS;
        if (rotatedRecently) {
          return { accessToken: await signAccessToken(existing.user), refreshToken: null };
        }

        await revokeFamily(prisma, existing.familyId);
        await recordAudit(prisma, {
          actorId: existing.userId,
          action: 'auth.refresh_reuse_detected',
          entityType: 'refresh_token_family',
          entityId: existing.familyId,
          req,
        });
        req.log?.warn({ userId: existing.userId, familyId: existing.familyId }, 'refresh token reuse detected');
        throw invalidSession();
      }

      const rotated = await prisma.$transaction(async (tx) => {
        const { token, record } = await issueRefreshToken(tx, existing.userId, existing.familyId, req);
        // Conditional update: only one concurrent request can revoke the old token.
        const { count } = await tx.refreshToken.updateMany({
          where: { id: existing.id, revokedAt: null },
          data: { revokedAt: new Date(), replacedById: record.id },
        });
        if (count === 0) throw new RotationRaceLost();
        return token;
      }).catch((err) => {
        if (err instanceof RotationRaceLost) return null;
        throw err;
      });

      return { accessToken: await signAccessToken(existing.user), refreshToken: rotated };
    },

    async logout(presentedToken, req) {
      if (!presentedToken) return;
      const existing = await prisma.refreshToken.findUnique({ where: { tokenHash: hashToken(presentedToken) } });
      if (!existing) return;

      await revokeFamily(prisma, existing.familyId);
      await recordAudit(prisma, { actorId: existing.userId, action: 'auth.logout', entityType: 'user', entityId: existing.userId, req });
    },
  };
}

class RotationRaceLost extends Error {}
