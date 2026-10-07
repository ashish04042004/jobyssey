import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, apiRequest, ApiError, idempotentRequest, session } from './api.js';

const json = (status, body) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

let calls;
function respond(...responses) {
  calls = [];
  globalThis.fetch = vi.fn(async (url, init) => {
    calls.push({ url, ...init });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return next;
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  session.setAccessToken('access-1');
});
afterEach(() => {
  vi.useRealTimers();
  session.clear();
});

describe('apiRequest', () => {
  it('sends the in-memory access token and unwraps JSON', async () => {
    respond(json(200, { data: { ok: true } }));
    await expect(apiRequest('/me')).resolves.toEqual({ data: { ok: true } });
    expect(calls[0].url).toBe('/api/me');
    expect(calls[0].headers.Authorization).toBe('Bearer access-1');
    expect(calls[0].credentials).toBe('include');
  });

  it('refreshes once on 401 and retries with the new token', async () => {
    respond(json(401, { error: { code: 'UNAUTHENTICATED' } }), json(200, { data: { accessToken: 'access-2' } }), json(200, { data: 'ok' }));
    await expect(apiRequest('/me')).resolves.toEqual({ data: 'ok' });
    expect(calls.map((c) => c.url)).toEqual(['/api/me', '/api/auth/refresh', '/api/me']);
    expect(calls[2].headers.Authorization).toBe('Bearer access-2');
  });

  it('ends the session when the refresh fails', async () => {
    const expired = vi.fn();
    session.onExpired(expired);
    respond(json(401, { error: { code: 'UNAUTHENTICATED' } }), json(401, { error: { code: 'UNAUTHENTICATED' } }));
    await expect(apiRequest('/me')).rejects.toBeInstanceOf(ApiError);
    expect(expired).toHaveBeenCalledOnce();
  });

  it('maps validation details to form field errors', async () => {
    respond(json(400, { error: { code: 'VALIDATION_ERROR', details: [{ path: 'email', message: 'Invalid email' }] } }));
    const err = await apiRequest('/me', { method: 'PATCH', body: {} }).catch((e) => e);
    expect(err.fieldErrors).toEqual({ email: 'Invalid email' });
  });
});

describe('idempotentRequest', () => {
  it('retries network failures and 503s with the same Idempotency-Key', async () => {
    respond(new TypeError('Failed to fetch'), json(503, { error: { code: 'UNAVAILABLE' } }), json(201, { data: { id: 'a1' } }));
    const pending = idempotentRequest('/applications', { method: 'POST', body: { jobId: 'j1' } });
    await vi.runAllTimersAsync();
    await expect(pending).resolves.toEqual({ data: { id: 'a1' } });

    const keys = calls.map((c) => c.headers['Idempotency-Key']);
    expect(keys).toHaveLength(3);
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('waits out IDEMPOTENCY_IN_PROGRESS', async () => {
    respond(json(409, { error: { code: 'IDEMPOTENCY_IN_PROGRESS' } }), json(200, { data: 'done' }));
    const pending = idempotentRequest('/jobs/j1/save', { method: 'POST' });
    await vi.runAllTimersAsync();
    await expect(pending).resolves.toEqual({ data: 'done' });
  });

  it('does not retry client errors or other conflicts', async () => {
    respond(json(409, { error: { code: 'VERSION_CONFLICT' } }));
    await expect(idempotentRequest('/applications/a1/status', { method: 'PATCH', body: {} })).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
    expect(calls).toHaveLength(1);
  });

  it('gives up after two retries', async () => {
    respond(new TypeError('offline'), new TypeError('offline'), new TypeError('offline'));
    const pending = idempotentRequest('/jobs', { method: 'POST', body: {} }).catch((e) => e);
    await vi.runAllTimersAsync();
    expect(await pending).toBeInstanceOf(TypeError);
    expect(calls).toHaveLength(3);
  });

  it('uses a fresh key for every new intent', async () => {
    respond(json(200, { data: 1 }), json(200, { data: 2 }));
    await api.jobs.save('j1');
    await api.jobs.save('j1');
    expect(calls[0].headers['Idempotency-Key']).not.toBe(calls[1].headers['Idempotency-Key']);
  });
});
