# Jobyssey — Architecture

> Jobyssey is a personal placement operating system: discover opportunities, track
> applications, manage deadlines and interviews, and never miss a placement event.

Target for V1: **~20 students**. The architecture is sized for that, but every
component is chosen so it can scale horizontally without a rewrite.

---

## 1. System overview

```text
                     ┌────────────────────────┐
                     │  React SPA (Vite)      │  Cloudflare Pages
                     └───────────┬────────────┘
                                 │ HTTPS  /api/*
                                 ▼
                     ┌────────────────────────┐
                     │  Express API (Node)    │  Render web service
                     │  auth · jobs · apps    │
                     │  interviews · docs     │
                     │  analytics · notifs    │
                     └──┬──────────┬───────┬──┘
                        │          │       │
             ┌──────────┘          │       └──────────────┐
             ▼                     ▼                      ▼
     ┌──────────────┐      ┌──────────────┐       ┌──────────────┐
     │ PostgreSQL   │      │ Redis        │       │ Object store │
     │ (Supabase)   │      │ (Upstash)    │       │ (Supabase    │
     │ source of    │      │ cache · rate │       │  Storage)    │
     │ truth        │      │ limits · Bull│       └──────────────┘
     └──────▲───────┘      └──────┬───────┘
            │                     │ BullMQ
            │              ┌──────▼───────┐
            └──────────────┤ Worker(s)    │  same image, different entrypoint
                           │ outbox relay │
                           │ reminders    │
                           │ matching     │
                           │ notifications│
                           └──────────────┘
```

Runtime for the beta: **1 API, 1 worker, 1 Postgres, 1 Redis.**
The worker is stateless and competes for jobs, so `Worker × N` works by just
running more replicas.

---

## 2. Guiding principles

1. **Postgres is the source of truth; Redis is disposable.** Anything in Redis
   (cache entries, rate-limit counters, queued jobs) can be lost and rebuilt.
   Reminders and events are persisted in Postgres first.
2. **API requests never wait on side effects.** Notifications, matching and
   analytics happen asynchronously in the worker.
3. **Every mutation that matters is idempotent** — at the HTTP layer
   (Idempotency-Key), at the DB layer (unique constraints), and in the worker
   (dedupe keys on notifications, deterministic BullMQ job IDs).
4. **Modular monolith, not microservices.** One codebase, one deployable image,
   two entrypoints (`server.js`, `worker.js`).
5. **Build the boring version first.** No Kafka, no Elasticsearch, no ML.

---

## 3. Backend layering

```text
routes/        HTTP wiring only (paths, middleware order)
controllers/   parse + validate request (zod), call service, shape response
services/      business logic, transactions, emits domain events
domain/        pure logic: state machine, match scoring (no I/O, unit-tested)
models/        Prisma client + repository helpers
queues/        queue definitions and producers
workers/       job processors
middleware/    auth, rbac, rate limit, idempotency, request id, errors
config/        env parsing (fail fast on bad config)
```

Rules: controllers never touch Prisma directly; domain modules never do I/O.

---

## 4. Application state machine

```text
 SAVED ──► APPLIED ──► OA ──► OA_COMPLETED ──► INTERVIEW ──► OFFER ──► ACCEPTED
   │          │  │      │          │               │           │
   │          │  └──────┼──────────┼──► INTERVIEW  │           │
   │          ▼         ▼          ▼               ▼           │
   │       REJECTED  REJECTED   REJECTED        REJECTED       │
   ▼          ▼         ▼          ▼               ▼           ▼
 WITHDRAWN (allowed from every non-terminal state, incl. declining an OFFER)
```

| From          | Allowed to                                   |
|---------------|----------------------------------------------|
| SAVED         | APPLIED, WITHDRAWN                           |
| APPLIED       | OA, INTERVIEW, REJECTED, WITHDRAWN           |
| OA            | OA_COMPLETED, REJECTED, WITHDRAWN            |
| OA_COMPLETED  | INTERVIEW, REJECTED, WITHDRAWN               |
| INTERVIEW     | OFFER, REJECTED, WITHDRAWN                   |
| OFFER         | ACCEPTED, WITHDRAWN                          |
| ACCEPTED      | — (terminal)                                 |
| REJECTED      | — (terminal)                                 |
| WITHDRAWN     | — (terminal)                                 |

Notes:

- `APPLIED → INTERVIEW` is allowed because many companies have no OA.
- Multiple interview rounds keep the application in `INTERVIEW`; individual
  rounds are tracked as `interviews` rows, not as statuses.
- Declining an offer is `OFFER → WITHDRAWN` with a note.
- Implemented in `backend/src/domain/applicationStatus.js` (pure, unit-tested).

**Concurrency:** `applications.version` is an optimistic-lock counter. A status
change runs `UPDATE ... WHERE id = $1 AND version = $2`; zero rows updated →
`409 VERSION_CONFLICT`. This stops two tabs racing each other into an invalid
state.

---

## 5. Domain events and the transactional outbox

Every status change (and a few other mutations) produces a domain event. To avoid
the classic "DB committed but the enqueue failed" (or vice versa) bug, events are
written to an **outbox table in the same transaction** as the business change.

```text
API request
  └─ BEGIN
       UPDATE applications SET status = 'OA', version = version + 1
       INSERT application_events (timeline row)
       INSERT audit_logs
       INSERT outbox_events (type = 'application.status_changed')
     COMMIT
                     │
Worker: outbox relay (every ~2s)
  SELECT ... FROM outbox_events WHERE published_at IS NULL
    ORDER BY created_at LIMIT 100 FOR UPDATE SKIP LOCKED
  → queue.add(type, payload, { jobId: outboxEvent.id })   // dedupe
  → UPDATE outbox_events SET published_at = now()
                     │
          ┌──────────┼───────────────┐
          ▼          ▼               ▼
     notifications  reminders     analytics
```

`FOR UPDATE SKIP LOCKED` lets several worker replicas relay concurrently without
double-publishing. The deterministic BullMQ `jobId` makes a re-publish (crash
between enqueue and `published_at` update) a no-op. Delivery is therefore
**at-least-once with idempotent consumers**.

### Event catalogue (V1)

| Event                          | Producer                | Consumers                         |
|--------------------------------|-------------------------|-----------------------------------|
| `application.created`          | applications service    | deadline reminders, analytics     |
| `application.status_changed`   | applications service    | deadline reminders, analytics     |
| `application.deleted`          | applications service    | deadline reminders (cancel)       |
| `interview.scheduled`          | interviews service      | reminder queue                    |
| `interview.rescheduled`        | interviews service      | reminder queue (enqueue new, drop old jobs) |
| `interview.cancelled`          | interviews service      | reminder queue (drop jobs)        |
| `interview.completed`          | interviews service      | reminder queue, analytics         |
| `job.published`                | jobs service (admin)    | job matching, deadline reminders  |
| `job.updated` / `job.archived` | jobs service            | deadline reminders of saved applications |
| `document.uploaded`            | documents service       | audit only                        |

Handlers live in `backend/src/workers/eventHandlers.js`; unknown event types
are acknowledged and ignored so producers can ship ahead of consumers.

---

## 6. Queues

| Queue             | Jobs                                                    |
|-------------------|---------------------------------------------------------|
| `domain-events`   | fan-out of outbox events to handlers (jobId = event id) |
| `reminders`       | delayed `reminder.fire` (jobId = reminder id); schedulers `reminder.sweep` (5 min) and `application.stale-sweep` (6 h) |
| `job-matching`    | `job.match` (jobId = `match-<jobId>`) — score a new job against all students |

In-app notifications are written directly by these consumers (one insert with
`ON CONFLICT DO NOTHING` on `(user_id, dedupe_key)`), so there is no separate
notifications queue: one fewer queue polling Upstash. All queues use the
`jobyssey` key prefix.

Job options (defaults): `attempts: 5`, exponential backoff starting at 2s,
`removeOnComplete: 1000`, `removeOnFail: 5000` (kept for inspection).

**Upstash note:** BullMQ polls Redis even when idle, and Upstash's free tier is
metered per command. Keep the number of queues small, raise `drainDelay` and
`stalledInterval` for low-traffic queues, and watch command usage during the
beta. If it becomes a problem, consolidate queues or run Redis next to the worker.

---

## 7. Reminders (deadline system)

Postgres `reminders` rows are the source of truth; BullMQ delayed jobs are the
delivery mechanism.

1. When an interview/OA is scheduled (or an application deadline is known), the
   service creates `reminders` rows (e.g. 24h and 1h before) **in the same
   transaction**, each with a deterministic `job_key` such as
   `interview:<id>:1440:<targetMs>`. Including the target time means a
   reschedule produces new keys, and moving back revives the old rows instead of
   colliding with them. Offsets whose time has already passed are skipped.
   Deadline reminders (1 day and 3 hours before a job's application deadline,
   while the application is still `SAVED`) are maintained by the worker in
   response to application and job events.
2. On the matching outbox event the worker enqueues a delayed job with
   `jobId = reminder.id` and marks the row `QUEUED`; delayed jobs of cancelled
   rows are removed.
3. On fire, the worker re-reads the reminder and its entity. If the row is no
   longer `PENDING`/`QUEUED`, the interview moved, was cancelled, or the
   application was applied to/deleted, it marks the row `CANCELLED` and exits
   (stale job). If the target time already passed (worker was asleep), it is
   cancelled as missed rather than sending "starts in 1 hour" after the fact.
   Otherwise it inserts the notification (`dedupe_key = job_key`) and marks the
   row `SENT` in one transaction. The text uses the time actually left
   ("opens in 5 hours"), not the nominal offset.
4. Rescheduling marks old rows `CANCELLED` and creates new ones.
5. The `reminder.sweep` scheduler (every 5 min, and once at worker start)
   enqueues `PENDING` rows the event path missed and re-creates delayed jobs for
   `QUEUED` rows more than 10 minutes overdue whose job is gone — this recovers
   from a Redis flush or a worker that was asleep.
6. After the last retry fails, the row is marked `FAILED` with `last_error`.

### Other background jobs
- **Job matching:** `job.published` → `job.match` scores the job against every
  student (batches of 500) and notifies those scoring ≥ 75, deduped per job.
- **Stale applications:** every 6 hours, applications in `APPLIED`, `OA`,
  `OA_COMPLETED` or `INTERVIEW` with no status change for 14 days get one nudge
  per status (`dedupe_key = stale:<id>:<statusChangedAtMs>`).

---

## 8. Cross-cutting concerns

### Authentication
- Passwords hashed with **argon2id**.
- **Access token:** JWT, 15 min, returned in the response body and kept in
  memory by the SPA (never in localStorage).
- **Refresh token:** opaque random 256-bit value, 30 days, sent as an
  `HttpOnly; Secure; SameSite` cookie scoped to `/api/auth`. Only its SHA-256
  hash is stored. Tokens **rotate on every refresh**; reuse of a rotated token
  revokes the whole token family (theft detection). A 30 s grace window absorbs
  the benign case of two tabs refreshing simultaneously, and the SPA
  single-flights refreshes within a tab.
- Cookie flags are configurable: `COOKIE_SAMESITE` (`lax` by default — correct
  when SPA and API share a site) and `COOKIE_SECURE` (defaults to `true` in
  production). Refresh/logout additionally reject foreign `Origin` headers.
- Role changes (`npm run user:set-role`) take effect on the next token refresh,
  because the role is embedded in the 15-minute access token.

### Authorization (RBAC)
- Roles: `STUDENT`, `ADMIN`.
- Students own their applications, interviews, documents, notifications —
  every query is scoped by `user_id` (ownership check, not just role check).
- Admins curate public job listings. Students may create **private** jobs for
  opportunities they found elsewhere.

### Rate limiting (Redis)
Fixed-window counters (`INCR` + `EXPIRE`, atomic via Lua):

| Scope                | Limit         | Key                       |
|----------------------|---------------|---------------------------|
| Login                | 5 / min       | `ip + email`              |
| Register             | 5 / hour      | `ip`                      |
| Create job           | 30 / min      | `user`                    |
| Create application   | 30 / min      | `user`                    |
| Authenticated API    | 100 / min     | `user`                    |

If Redis is unreachable, limiters **fail open** (log + allow), except login,
which fails closed.

### Idempotency
Critical `POST`s accept an `Idempotency-Key` header. See `api.md` §2.4 and the
`idempotency_keys` table in `schema.md`. The DB also enforces
`UNIQUE (user_id, job_id)` on applications as the last line of defence.

### Caching (Redis, cache-aside)
| Data                    | Key                                    | TTL   | Invalidation               |
|-------------------------|----------------------------------------|-------|----------------------------|
| Public job listings     | `jobs:v{n}:{hash(query)}`              | 5 min | bump `jobs:version` on write |
| Company profile         | `company:{id}`                         | 1 h   | delete on update           |
| Dashboard summary       | `dash:{userId}`                        | 5 min | delete on app/interview change |

Versioned keys make "invalidate all job listing pages" a single `INCR`.

### Observability
- Structured JSON logs (pino), a `requestId` on every request and log line.
- `GET /api/health` (liveness) and `GET /api/health/ready` (DB, Redis, worker
  heartbeat).
- Product metrics (signups, WAU, applications created, reminders delivered,
  p95 latency, queue lag) computed from Postgres + logs — no third-party tracking.

### Graceful shutdown
On `SIGTERM`/`SIGINT`: stop accepting connections, let in-flight requests finish
(10s cap), close BullMQ workers (finish current job), then close Redis and
Prisma.

---

## 9. Deployment (beta, ~$0)

| Component   | Host                       | Notes |
|-------------|----------------------------|-------|
| Frontend    | Cloudflare Pages           | Static build of `frontend/` |
| API         | Render free web service    | Docker image from `backend/` |
| Worker      | Co-located with the API for the beta (`RUN_WORKER_IN_API=true`) | Split out when a worker host is chosen |
| Postgres    | Supabase free              | Use the **pooled** connection string for the app, direct one for migrations |
| Redis       | Upstash free               | TLS (`rediss://`) |
| Files       | Supabase Storage           | Private bucket, signed URLs, 5 MB/file limit |

### Things that will bite if ignored
1. **Render free instances sleep after inactivity.** A sleeping process cannot
   fire reminders. Mitigations: an external uptime ping every ~10 minutes during
   the beta, *and* the `reminder.sweep` job so anything missed is delivered on
   wake-up.
2. **Cross-site cookies.** `*.pages.dev` and `*.onrender.com` are different
   sites; browsers increasingly block third-party cookies, which breaks the
   refresh cookie. Serve both under one domain (`app.jobyssey.xx` +
   `api.jobyssey.xx`), or proxy `/api/*` through a Cloudflare Pages Function so
   the browser only ever talks to one origin.
3. **Supabase free projects pause after a period of inactivity.** Real beta usage
   prevents this; keep an eye on it during quiet weeks.
4. **Connection limits.** Prisma pool size kept small (`connection_limit=5`) and
   the Supabase pooler used at runtime.

### Local development
`docker compose up` runs `postgres`, `redis`, `api`, and `worker` exactly like
production (separate API and worker containers from the same image). The
frontend runs with `npm run dev` and proxies `/api` to the API.

---

## 10. Out of scope for V1

College ERP, recruiter CRM, chat, video interviews, AI resume/interview tools,
ML recommendations, LeetCode clone, WhatsApp/SMS/push, mobile app,
Elasticsearch, Kafka, Kubernetes, microservices.
Multi-tenancy is **schema-ready** (`organization_id`, nullable) but not built.
