import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { SignJWT, jwtVerify } from 'jose';
import { AppError } from '../utils/errors.js';

const AUDIENCE = 'jobyssey-storage';

/**
 * Disk-backed storage for development and tests. It mimics a signed-URL object
 * store: URLs point at `/api/storage/<token>`, where the token is a short-lived
 * JWT naming the object key and the allowed operation.
 */
export function createLocalStorage({ dir, secret }) {
  const root = path.resolve(dir);
  const key = new TextEncoder().encode(secret);

  const sign = (claims, expiresInSec) =>
    new SignJWT(claims).setProtectedHeader({ alg: 'HS256' }).setAudience(AUDIENCE).setIssuedAt().setExpirationTime(`${expiresInSec}s`).sign(key);

  async function verify(token, op) {
    try {
      const { payload } = await jwtVerify(token, key, { audience: AUDIENCE, algorithms: ['HS256'] });
      if (payload.op === op) return payload;
    } catch {
      // fall through
    }
    throw new AppError(403, 'FORBIDDEN', 'This link is invalid or has expired');
  }

  function filePath(objectKey) {
    const full = path.resolve(root, objectKey);
    if (!full.startsWith(root + path.sep)) throw new Error(`Refusing object key outside storage root: ${objectKey}`);
    return full;
  }

  const expiry = (seconds) => new Date(Date.now() + seconds * 1000).toISOString();

  return {
    name: 'local',

    async createUploadUrl(objectKey, { mimeType, sizeBytes, expiresInSec }) {
      const token = await sign({ op: 'put', key: objectKey, mime: mimeType, max: sizeBytes }, expiresInSec);
      return { url: `/api/storage/${token}`, method: 'PUT', headers: { 'Content-Type': mimeType }, expiresAt: expiry(expiresInSec) };
    },

    async stat(objectKey) {
      try {
        return { sizeBytes: (await stat(filePath(objectKey))).size };
      } catch (err) {
        if (err.code === 'ENOENT') return null;
        throw err;
      }
    },

    async createDownloadUrl(objectKey, { filename, mimeType, expiresInSec }) {
      const token = await sign({ op: 'get', key: objectKey, name: filename, mime: mimeType }, expiresInSec);
      return { url: `/api/storage/${token}`, expiresAt: expiry(expiresInSec) };
    },

    async remove(objectKey) {
      await rm(filePath(objectKey), { force: true });
    },

    /** Handles `PUT /api/storage/:token`. Each URL can be written once. */
    async receive(token, req) {
      const claims = await verify(token, 'put');
      if (req.get('content-type') !== claims.mime) {
        throw new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', `Expected Content-Type ${claims.mime}`);
      }
      if (Number(req.get('content-length') ?? 0) > claims.max) {
        throw new AppError(413, 'FILE_TOO_LARGE', 'File is larger than declared');
      }

      const target = filePath(claims.key);
      await mkdir(path.dirname(target), { recursive: true });
      let written = 0;
      const limit = new Transform({
        transform(chunk, _encoding, done) {
          written += chunk.length;
          if (written > claims.max) done(new AppError(413, 'FILE_TOO_LARGE', 'File is larger than declared'));
          else done(null, chunk);
        },
      });
      try {
        await pipeline(req, limit, createWriteStream(target, { flags: 'wx' }));
      } catch (err) {
        if (err.code === 'EEXIST') throw new AppError(409, 'ALREADY_UPLOADED', 'This upload link was already used');
        await rm(target, { force: true });
        throw err;
      }
      return { sizeBytes: written };
    },

    /** Handles `GET /api/storage/:token`. */
    async open(token) {
      const claims = await verify(token, 'get');
      const target = filePath(claims.key);
      const info = await stat(target).catch(() => null);
      if (!info) throw new AppError(404, 'NOT_FOUND', 'File not found');
      return { stream: createReadStream(target), sizeBytes: info.size, filename: claims.name, mimeType: claims.mime };
    },
  };
}
