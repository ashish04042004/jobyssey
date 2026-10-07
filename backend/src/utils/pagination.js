import { badRequest } from './errors.js';

export function encodeCursor(offset) {
  return Buffer.from(JSON.stringify({ o: offset })).toString('base64url');
}

export function decodeCursor(cursor) {
  if (!cursor) return 0;
  try {
    const { o } = JSON.parse(Buffer.from(cursor, 'base64url').toString());
    if (Number.isInteger(o) && o >= 0) return o;
  } catch {
    // fall through
  }
  throw badRequest('Invalid cursor');
}

export function nextCursor(offset, limit, total) {
  return offset + limit < total ? encodeCursor(offset + limit) : null;
}
