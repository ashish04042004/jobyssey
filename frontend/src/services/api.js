const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error?.message ?? `Request failed with status ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.code = body?.error?.code ?? 'UNKNOWN';
    this.details = body?.error?.details;
    this.requestId = body?.error?.requestId;
    this.body = body;
  }

  /** Maps validation details to `{ fieldName: message }` for forms. */
  get fieldErrors() {
    if (this.code !== 'VALIDATION_ERROR' || !Array.isArray(this.details)) return {};
    return Object.fromEntries(this.details.map(({ path, message }) => [path, message]));
  }
}

// The access token lives only in memory; the refresh token is an HttpOnly cookie.
let accessToken = null;
let refreshInFlight = null;
let sessionExpiredListener = () => {};

export const session = {
  setAccessToken(token) {
    accessToken = token;
  },
  clear() {
    accessToken = null;
  },
  onExpired(listener) {
    sessionExpiredListener = listener;
  },
};

async function send(path, { method = 'GET', body, headers, signal } = {}) {
  const response = await fetch(`${BASE_URL}/api${path}`, {
    method,
    signal,
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      ...(body !== undefined && { 'Content-Type': 'application/json' }),
      ...(accessToken && { Authorization: `Bearer ${accessToken}` }),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(response.status, payload);
  return payload;
}

/** Single-flight: concurrent callers share one refresh request. */
export function refreshSession() {
  refreshInFlight ??= send('/auth/refresh', { method: 'POST' })
    .then(({ data }) => {
      accessToken = data.accessToken;
      return accessToken;
    })
    .finally(() => {
      refreshInFlight = null;
    });
  return refreshInFlight;
}

/**
 * Authenticated request. On a 401 it refreshes the access token once and
 * retries; if that fails the session is over and listeners are notified.
 */
export async function apiRequest(path, options = {}) {
  try {
    return await send(path, options);
  } catch (err) {
    if (!(err instanceof ApiError) || err.status !== 401) throw err;
  }

  try {
    await refreshSession();
  } catch (refreshError) {
    accessToken = null;
    sessionExpiredListener();
    throw refreshError;
  }
  return send(path, options);
}

const RETRY_DELAYS_MS = [400, 1500];

function isRetryable(err) {
  if (err?.name === 'AbortError') return false;
  if (!(err instanceof ApiError)) return err instanceof TypeError; // fetch network failure
  return [502, 503, 504].includes(err.status) || err.code === 'IDEMPOTENCY_IN_PROGRESS';
}

/**
 * One user intent = one Idempotency-Key. Transient failures are retried with
 * the same key, so the server applies the write at most once.
 */
export async function idempotentRequest(path, options = {}) {
  const headers = { ...options.headers, 'Idempotency-Key': crypto.randomUUID() };
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await apiRequest(path, { ...options, headers });
    } catch (err) {
      if (attempt >= RETRY_DELAYS_MS.length || !isRetryable(err)) throw err;
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
    }
  }
}

export const api = {
  health: (signal) => send('/health/ready', { signal }),

  register: (body) => send('/auth/register', { method: 'POST', body }),
  login: (body) => send('/auth/login', { method: 'POST', body }),
  logout: () => send('/auth/logout', { method: 'POST' }),

  me: () => apiRequest('/me'),
  updateMe: (body) => apiRequest('/me', { method: 'PATCH', body }),

  jobs: {
    list: (params = {}, signal) => apiRequest(`/jobs${toQuery(params)}`, { signal }),
    get: (id, signal) => apiRequest(`/jobs/${id}`, { signal }),
    create: (body) => idempotentRequest('/jobs', { method: 'POST', body }),
    update: (id, body) => apiRequest(`/jobs/${id}`, { method: 'PATCH', body }),
    archive: (id) => apiRequest(`/jobs/${id}`, { method: 'DELETE' }),
    save: (id) => idempotentRequest(`/jobs/${id}/save`, { method: 'POST' }),
  },

  companies: {
    search: (q, signal) => apiRequest(`/companies${toQuery({ q })}`, { signal }),
  },

  applications: {
    list: (params = {}, signal) => apiRequest(`/applications${toQuery(params)}`, { signal }),
    get: (id, signal) => apiRequest(`/applications/${id}`, { signal }),
    create: (body) => idempotentRequest('/applications', { method: 'POST', body }),
    update: (id, body) => apiRequest(`/applications/${id}`, { method: 'PATCH', body }),
    changeStatus: (id, body) => idempotentRequest(`/applications/${id}/status`, { method: 'PATCH', body }),
    remove: (id) => apiRequest(`/applications/${id}`, { method: 'DELETE' }),
    prep: {
      add: (id, topic) => idempotentRequest(`/applications/${id}/prep`, { method: 'POST', body: { topic } }),
      update: (id, itemId, body) => apiRequest(`/applications/${id}/prep/${itemId}`, { method: 'PATCH', body }),
      remove: (id, itemId) => apiRequest(`/applications/${id}/prep/${itemId}`, { method: 'DELETE' }),
    },
  },

  interviews: {
    list: (params = {}, signal) => apiRequest(`/interviews${toQuery(params)}`, { signal }),
    get: (id, signal) => apiRequest(`/interviews/${id}`, { signal }),
    schedule: (applicationId, body) =>
      idempotentRequest(`/applications/${applicationId}/interviews`, { method: 'POST', body }),
    update: (id, body) => apiRequest(`/interviews/${id}`, { method: 'PATCH', body }),
    remove: (id) => apiRequest(`/interviews/${id}`, { method: 'DELETE' }),
  },

  agenda: (params, signal) => apiRequest(`/agenda${toQuery(params)}`, { signal }),

  notifications: {
    list: (params = {}, signal) => apiRequest(`/notifications${toQuery(params)}`, { signal }),
    unreadCount: (signal) => apiRequest('/notifications/unread-count', { signal }),
    markRead: (id) => apiRequest(`/notifications/${id}/read`, { method: 'PATCH' }),
    markAllRead: () => apiRequest('/notifications/read-all', { method: 'PATCH' }),
  },

  admin: {
    metrics: (signal) => apiRequest('/admin/metrics', { signal }),
    failedJobs: (queue, signal) => apiRequest(`/admin/queues/${queue}/failed`, { signal }),
    retryJob: (queue, jobId) =>
      apiRequest(`/admin/queues/${queue}/jobs/${encodeURIComponent(jobId)}/retry`, { method: 'POST' }),
  },
};

function toQuery(params) {
  const entries = Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== '');
  return entries.length ? `?${new URLSearchParams(entries)}` : '';
}
