# Jobyssey — API Contract

Base path: `/api`. JSON in, JSON out. All timestamps are ISO-8601 UTC.

---

## 1. Status

| Area           | Phase | Status      |
|----------------|-------|-------------|
| Health         | 1     | Implemented |
| Auth / Me      | 2     | Implemented |
| Jobs           | 3     | Implemented |
| Applications   | 4     | Implemented |
| Interviews / Agenda | 5 | Implemented |
| Notifications  | 6     | Implemented |
| Idempotency, Admin | 7 | Implemented |
| Documents      | 8     | Planned     |
| Analytics      | 9     | Planned     |

---

## 2. Conventions

### 2.1 Response envelope

Success:

```json
{ "data": { ... }, "meta": { "nextCursor": "..." } }
```

Error:

```json
{
  "error": {
    "code": "INVALID_TRANSITION",
    "message": "Cannot move application from SAVED to OFFER",
    "details": { "allowed": ["APPLIED", "WITHDRAWN"] },
    "requestId": "b1c2..."
  }
}
```

### 2.2 Error codes

| HTTP | code                    | When |
|------|-------------------------|------|
| 400  | `VALIDATION_ERROR`      | body/query failed zod validation (`details` lists fields) |
| 401  | `UNAUTHENTICATED`       | missing/expired access token |
| 403  | `FORBIDDEN`             | authenticated but not allowed (role or ownership) |
| 404  | `NOT_FOUND`             | also returned for resources owned by someone else (no existence leak) |
| 409  | `CONFLICT`              | unique violation (e.g. email taken) |
| 409  | `INVALID_TRANSITION`    | state machine rejected the status change |
| 409  | `VERSION_CONFLICT`      | optimistic-lock mismatch; client should refetch |
| 409  | `IDEMPOTENCY_IN_PROGRESS` | same key still being processed |
| 422  | `IDEMPOTENCY_KEY_REUSED`| same key, different request body |
| 429  | `RATE_LIMITED`          | `Retry-After` header set |
| 500  | `INTERNAL`              | never leaks stack traces |
| 503  | `UNAVAILABLE`           | readiness failure |

### 2.3 Pagination

Cursor-based: `?limit=20&cursor=<opaque>`; response `meta.nextCursor` is `null`
on the last page. `limit` max 100.

### 2.4 Idempotency

Endpoints marked **[idem]** accept `Idempotency-Key: <uuid>` (8–200 chars of
`A–Z a–z 0–9 - _ . :`; anything else is a `400`). The header is optional; keys
are scoped per user.

- First request: processed normally; any response below 500 is stored for 24 h
  (including 4xx — the same request gets the same answer).
- Repeat with same key + same method, path and body: stored response replayed
  with header `Idempotent-Replayed: true`. Body key order does not matter.
- Repeat while the first is still running: `409 IDEMPOTENCY_IN_PROGRESS`.
  A claim older than 30 s is treated as a crashed request and taken over.
- Same key, different request: `422 IDEMPOTENCY_KEY_REUSED`.
- A 5xx (or a dropped connection) releases the key so the client can retry.

[idem] endpoints: `POST /jobs`, `POST /jobs/:id/save`, `POST /applications`,
`PATCH /applications/:id/status`, `POST /applications/:id/prep`,
`POST /applications/:id/interviews`.

The frontend generates one key per user *intent* (e.g. per click on "Track
application"), not per HTTP attempt: network errors, 502/503/504 and
`IDEMPOTENCY_IN_PROGRESS` are retried twice (0.4 s, 1.5 s) with the same key.

### 2.5 Auth

`Authorization: Bearer <accessToken>` on every endpoint except `/health*` and
`/auth/register|login|refresh`. The refresh token travels only in the
`jobyssey_rt` HttpOnly cookie (path `/api/auth`).

### 2.6 Headers

- Every response carries `X-Request-Id` (echoed if the client sent one).
- Rate-limited routes return `RateLimit-Limit`, `RateLimit-Remaining`,
  `RateLimit-Reset`.

---

## 3. Health

### `GET /api/health`
Liveness. Never touches dependencies.
```json
{ "data": { "status": "ok", "uptimeSeconds": 42, "version": "0.1.0" } }
```

### `GET /api/health/ready`
Readiness. `200` if all checks pass, else `503` with the same body.
```json
{
  "data": {
    "status": "ok",
    "checks": {
      "database": { "status": "ok", "latencyMs": 3 },
      "redis":    { "status": "ok", "latencyMs": 1 },
      "worker":   { "status": "ok", "lastHeartbeatAt": "2026-10-07T16:50:00.000Z" }
    }
  }
}
```
The worker check is informational (`degraded`, not `error`) — the API can serve
requests without it.

---

## 4. Auth

### `POST /api/auth/register` — rate limit 5/h/IP
```json
{
  "name": "Ashish", "email": "ashish@example.com", "password": "••••••••••",
  "college": "IIT (ISM) Dhanbad", "branch": "CSE", "graduationYear": 2026
}
```
Password: ≥ 10 chars. → `201 { data: { user, accessToken } }` + refresh cookie.

### `POST /api/auth/login` — rate limit 5/min per IP+email
`{ "email", "password" }` → `200 { data: { user, accessToken } }` + cookie.
Wrong email and wrong password return the same `401 INVALID_CREDENTIALS` with
equal timing (a dummy hash is verified for unknown emails). The limiter fails
closed: if Redis is down, login returns `503` rather than going unprotected.

### `POST /api/auth/refresh` — rate limit 30/min/IP
Uses the cookie. Rotates the refresh token. → `200 { data: { accessToken } }`.

- Presenting a token that was rotated **less than 30 s ago** (two tabs refreshing
  at once) returns a fresh access token *without* rotating again or setting a
  cookie — the browser already holds the newer cookie.
- Presenting a token rotated **longer ago** is treated as theft: every token in
  that login's family is revoked, an `auth.refresh_reuse_detected` audit row is
  written, and the caller gets `401`.
- Requests whose `Origin` header is not in `CORS_ORIGINS` get `403` (CSRF guard
  for cookie-authenticated endpoints).

### `POST /api/auth/logout`
Revokes the current refresh token family, clears cookie. → `204` (also when
there is no session).

### `GET /api/me`
→ `200 { data: user }` (profile incl. preferences).

### `PATCH /api/me`
Partial update of profile fields: `name, college, degree, branch,
graduationYear, preferredRoles[] (≤10), preferredLocations[] (≤10), minCtcLpa,
skills[] (≤30)`. List entries are de-duplicated case-insensitively. Any other
field (`email`, `role`, ...) is rejected with `400`.

All `/api/me` (and future authenticated) routes share a 100 req/min/user limit.

---

## 5. Jobs

### `GET /api/jobs`
Query: `q` (title/company/role search), `location`, `roleCategory`,
`graduationYear`, `minCtc`, `employmentType` (comma-separated),
`includeExpired` (default `false`), `mine` (only jobs I added),
`sort=match|deadline|recent` (default `match`), `limit` (≤100), `cursor`.

Returns public active jobs plus the caller's private jobs. Each item includes
`matchScore` (0–100), `matchBreakdown`, `canEdit`, and the caller's
`application` (id + status) if one exists. `meta.total` is the full match count.

`location` and `roleCategory` use the same synonym tables as scoring, so
`location=Delhi NCR` finds Noida and Gurugram jobs and `roleCategory=SDE` finds
"Software Engineer" titles.

Implementation note: the shared public-job query (DB-side filters only) is
cached in Redis for 5 minutes under a versioned key; every public job write
bumps the version. Personal scoring, private jobs and application status are
layered on per request, and candidates are capped at 500 — ample for the beta,
after which scoring should move into SQL.

```json
{
  "data": [{
    "id": "…", "company": { "id": "…", "name": "Microsoft" },
    "title": "Software Engineer", "locations": ["Noida"],
    "ctcMinLpa": 20, "ctcMaxLpa": 20, "graduationYears": [2026],
    "applicationDeadline": "2026-10-15T18:29:59.000Z",
    "matchScore": 95,
    "matchBreakdown": { "role": 30, "location": 25, "graduation": 25, "salary": 15 },
    "application": null
  }],
  "meta": { "nextCursor": null }
}
```

#### Match scoring (deterministic)
| Signal      | Points | Rule |
|-------------|--------|------|
| Role        | 30     | `role_category` or title matches a preferred role; 15 if user has no preference |
| Location    | 25     | any job location in preferred locations, or remote and "Remote" preferred; 12 if no preference |
| Graduation  | 25     | user's year ∈ `graduation_years`, or list empty |
| Salary      | 20     | `ctc_max_lpa ≥ min_ctc_lpa`; 10 if CTC unknown or no preference |

### `GET /api/jobs/:id`
Full job detail + `matchScore` + caller's application, if any.

### `POST /api/jobs` **[idem]** — rate limit 30/min
Students create `PRIVATE` jobs (opportunities found elsewhere); admins may set
`visibility: "PUBLIC"`. Company is given by `companyId` or `companyName`
(find-or-create by slug).

### `PATCH /api/jobs/:id` / `DELETE /api/jobs/:id`
Owner (private job) or admin (public job). Students get `403` on public jobs and
`404` on other students' private jobs. `DELETE` archives (`is_active = false`):
the job leaves listings, but anyone who already tracks it can still open it.

### `POST /api/jobs/:id/save` **[idem]**
Creates an application in `SAVED` with its first timeline event (or returns the
existing one). → `201` created / `200` already tracked. Concurrent clicks are
safe: the `UNIQUE (user_id, job_id)` constraint picks one winner and the others
return it.

### `GET /api/companies?q=micro&limit=8`
Company autocomplete for the job form.

---

## 6. Applications

### `POST /api/applications` **[idem]** — rate limit 30/min
```json
{ "jobId": "…", "status": "APPLIED", "appliedAt": "2026-10-02T10:00:00Z",
  "resumeId": "…", "notes": "Referred by X" }
```
`status` may be `SAVED` or `APPLIED` (default `SAVED`). Returns `201` with the
application; returns `200` with the existing application if one already exists
for this job (`UNIQUE (user_id, job_id)`). `appliedAt` may be back-dated but not
in the future. Tracking a job again after deleting its application starts a
fresh application (the audit log keeps the old history).

### `GET /api/applications`
Query: `status` (comma-separated), `q`, `sort=updated|deadline|company`,
`limit`, `cursor`. `meta.counts` has a count per status for the current search,
ignoring the `status` filter, so the UI can render tab badges from one call.

### `GET /api/applications/:id`
Includes `job`, `company`, `resume`, `timeline[]` (application_events),
`interviews[]`, `prepItems[]`, and `allowedTransitions[]` so the UI only shows
valid buttons.

### `PATCH /api/applications/:id`
Non-status fields: `notes`, `resumeId`.

### `PATCH /api/applications/:id/status` **[idem]**
```json
{ "status": "OA", "note": "Got HackerRank link", "occurredAt": "2026-10-04T09:00:00Z",
  "expectedVersion": 3 }
```
→ `200` updated application, or `409 INVALID_TRANSITION` (`details.allowed`) /
`409 VERSION_CONFLICT` (`details.currentVersion`, `details.currentStatus`).
`expectedVersion` is optional; without it the server still uses the version it
read as an optimistic lock, so two concurrent requests can never both apply.
`occurredAt` defaults to now and may be back-dated; the timeline is ordered by
when events were recorded. The first move to `APPLIED` sets `appliedAt`.
Side effects (in one transaction): timeline row, audit log, outbox event.

### `DELETE /api/applications/:id`
Soft delete. → `204`.

### Prep items
```http
GET    /api/applications/:id/prep
POST   /api/applications/:id/prep            { "topic": "Graphs" }        [idem]
PATCH  /api/applications/:id/prep/:itemId    { "isDone": true }
DELETE /api/applications/:id/prep/:itemId
```
Topics are unique per application (`409 CONFLICT` on duplicates) and keep their
insertion order.

---

## 7. Interviews / OAs

### `POST /api/applications/:id/interviews` **[idem]** — rate limit 30/min
```json
{ "type": "OA", "title": "HackerRank OA", "scheduledAt": "2026-10-08T13:30:00Z",
  "endsAt": "2026-10-08T18:29:00Z", "meetingUrl": null, "notes": null,
  "reminderOffsetsMinutes": [1440, 60] }
```
`type`: `OA | TECHNICAL | HR | MANAGERIAL | GROUP_DISCUSSION | OTHER`. For an OA,
`scheduledAt` is when the test opens and `endsAt` when it is due. `endsAt` must be
after `scheduledAt`; `meetingUrl` must be http(s). `reminderOffsetsMinutes`
(default `[1440, 60]`): up to 5 values between 5 minutes and 7 days, deduplicated.
Past rounds can be logged (they get no reminders).

In the same transaction the server writes one `reminders` row per offset whose
time is still in the future (`job_key = interview:<id>:<offset>:<targetMs>`), an
audit row and an `interview.scheduled` outbox event. → `201` with the interview
and its `reminders[]`.

### `GET /api/interviews`
Query: `from`, `to`, `status` (comma-separated), `order=asc|desc`, `limit`,
`cursor`. Each item includes `application.job` for display. Rounds of deleted
applications are hidden.

### `GET /api/interviews/:id`
Includes `reminders[]` (`remindAt`, `status`), excluding cancelled ones.

### `PATCH /api/interviews/:id`
Any create field plus `status: SCHEDULED | COMPLETED | CANCELLED`. Reminder rows
are reconciled on every change: moving `scheduledAt` cancels the old rows and
creates new ones (moving it back revives them); `COMPLETED`/`CANCELLED` cancels
them; back to `SCHEDULED` restores them. Outbox: `interview.rescheduled`,
`interview.cancelled`, `interview.completed`.

### `DELETE /api/interviews/:id` → `204`; reminders are cancelled.

Moving an application to `REJECTED` or `WITHDRAWN` cancels its upcoming
`SCHEDULED` rounds and their reminders; soft-deleting it cancels all of them.

### `GET /api/agenda?from=…&to=…`
Range ≤ 62 days. Merges scheduled rounds with application deadlines of jobs
that are still `SAVED` (not yet applied to), sorted by time:
```json
{ "data": [
  { "kind": "OA", "at": "…", "interview": { "id": "…", "type": "OA", "title": "…",
    "endsAt": null, "meetingUrl": "…" }, "application": { "id": "…", "status": "OA" },
    "job": { "id": "…", "title": "SDE Intern", "company": { "name": "Flipkart" } } },
  { "kind": "DEADLINE", "at": "…", "interview": null, "application": { … }, "job": { … } }
] }
```
`kind` is `OA | INTERVIEW | DEADLINE`. Powers the dashboard's "Coming up" card.

---

## 8. Documents

Direct-to-storage upload; the API never streams file bytes.

1. `POST /api/documents/upload-url`
   `{ "label": "Resume — Backend", "type": "RESUME", "filename": "cv.pdf", "mimeType": "application/pdf", "sizeBytes": 183422 }`
   → `201 { data: { document, uploadUrl, expiresAt } }` (document `PENDING`).
2. Client `PUT`s the file to `uploadUrl`.
3. `POST /api/documents/:id/complete` → verifies the object exists and its size,
   marks `READY`.

```http
GET    /api/documents
GET    /api/documents/:id/download-url    → short-lived signed URL
DELETE /api/documents/:id                 → soft delete (204)
```

Limits: PDF/DOCX only, ≤ 5 MB, ≤ 20 documents per user.

---

## 9. Notifications

```http
GET   /api/notifications?unread=true&limit=20&cursor=…
GET   /api/notifications/unread-count
PATCH /api/notifications/:id/read
PATCH /api/notifications/read-all
```
`GET /api/notifications` returns newest first with
`meta: { total, unread, nextCursor }`; each item is
`{ id, type, title, body, link, readAt, createdAt }` where `type` is
`INTERVIEW | DEADLINE | JOB_MATCH | STALE_APPLICATION | SYSTEM` and `link` is an
in-app path. `unread-count` → `{ data: { count } }` (the SPA polls it every
minute and on tab focus). `read-all` → `{ data: { updated } }`.

Notifications are created only by the worker (reminders, job matching, stale
nudges); there is no public create endpoint.

---

## 10. Analytics

### `GET /api/analytics/dashboard`
Everything the dashboard needs in one call (cached 5 min per user):
```json
{
  "data": {
    "today": [
      { "kind": "OA", "title": "Amazon OA", "dueAt": "…", "link": "/applications/…" }
    ],
    "pipeline": { "SAVED": 12, "APPLIED": 27, "OA": 8, "INTERVIEW": 4, "OFFER": 1 },
    "thisMonth": { "applications": 14, "interviews": 5, "offers": 1 },
    "staleApplications": [{ "id": "…", "company": "Amazon", "daysSinceUpdate": 12 }]
  }
}
```

### `GET /api/analytics/applications`
Query: `from`, `to`. Funnel and per-company conversion computed from
`application_events`:
```json
{
  "data": {
    "funnel": { "applied": 27, "oa": 12, "interview": 6, "offer": 2 },
    "conversion": { "appliedToOa": 0.44, "appliedToInterview": 0.22, "interviewToOffer": 0.33 },
    "byCompany": [{ "company": "Amazon", "applied": 5, "oa": 2, "interview": 1, "offer": 0 }],
    "monthly": [{ "month": "2026-09", "applications": 9 }, { "month": "2026-10", "applications": 14 }]
  }
}
```

---

## 11. Admin (minimal)

`ADMIN` role only (`403 FORBIDDEN` otherwise).

### `GET /api/admin/metrics`
Usage over the last 7 days plus the health of the async pipeline:
```json
{
  "data": {
    "generatedAt": "…",
    "users": { "total": 120, "newLast7Days": 14, "activeLast7Days": 63 },
    "applications": { "total": 1840, "createdLast7Days": 212, "updatedLast7Days": 530 },
    "reminders": {
      "byStatus": { "PENDING": 3, "QUEUED": 410, "SENT": 2200, "CANCELLED": 380, "FAILED": 2 },
      "sentLast7Days": 312, "failedLast7Days": 1, "deliveryRate": 0.997
    },
    "notifications": { "createdLast7Days": 540 },
    "outbox": { "pending": 0, "retrying": 0, "lagSeconds": 0 },
    "queues": [{ "name": "reminders", "counts": { "waiting": 0, "active": 0, "delayed": 410, "failed": 1, "completed": 900, "paused": 0 } }],
    "worker": { "status": "ok", "lastHeartbeatAt": "…", "workerId": "…" }
  }
}
```
"Active" = issued a refresh token (login or silent refresh) in the window.
`queues` is `null` if Redis is unreachable; `worker.status` is `down` when no
heartbeat arrived in the last 45 s.

### `GET /api/admin/queues/:queue/failed?limit=20`
Most recent failed jobs of `domain-events`, `reminders` or `job-matching`
(BullMQ keeps the last 5000): `id`, `name`, `failedReason`, `attemptsMade`,
`maxAttempts`, `createdAt`, `failedAt`, `data`. Unknown queue → `404`.

### `POST /api/admin/queues/:queue/jobs/:jobId/retry`
Moves a failed job back to `waiting`. `404` if the job is gone,
`409 JOB_NOT_FAILED` if it is not in the failed state. Safe because every
consumer is idempotent.
