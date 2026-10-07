# Jobyssey — Testing & Performance

What is tested, how to run it, and what the system does under load on one
laptop. The V1 target is ~20 students; the numbers below show how much headroom
that leaves and what to change first if it ever stops being enough.

---

## 1. Test suites

Backend: **187 tests in 15 files** (Jest + Supertest). Frontend: **14 tests** (Vitest).

| Suite | What it covers |
|-------|----------------|
| Backend unit | Pure rules: status state machine, role checks, match scoring, funnel maths, Supabase Storage driver (mocked HTTP) |
| Backend integration | Every route against a real Postgres (`jobyssey_test`) and Redis (DB 15): auth & refresh rotation, ownership, optimistic locking, idempotency keys, outbox relay, workers, reminders, documents, analytics, admin |
| Backend platform | Rate limits (window, fail-open/closed), 100 req/min per user, no 5xx detail leakage, 413 on oversized bodies, bad cursors, forged JWTs, security headers, CORS / `Idempotency-Key` preflight |
| Frontend | Date/time formatting; the API client: token refresh on 401, session end, field-error mapping, idempotent retries (network errors, 503, `IDEMPOTENCY_IN_PROGRESS`, retry cap, one key per intent) |

Backend coverage (`npm run test:coverage`, HTML report in `backend/coverage/`):

| Statements | Branches | Functions | Lines |
|------------|----------|-----------|-------|
| 95.3%      | 88.6%    | 97.3%     | 95.3% |

```bash
cd backend
npm test                  # needs `docker compose up -d postgres redis`
npm run test:coverage

cd frontend
npm test
```

---

## 2. Load tests

Both scripts seed throw-away users under `@load.jobyssey.test`, run, and delete
everything they created (also on failure). They target the Docker stack.

```bash
docker compose up -d --build
cd backend
npm run load:api                     # --url --duration 10 --connections 50 --usersPerScenario 500
npm run load:worker -- --count 2000  # --timeout 180
```

**Machine:** Intel i5-11400H (6 cores / 12 threads), Windows 11, Docker Desktop
(WSL 2). API, worker, Postgres 16 and Redis 7 all in containers on the same box,
one Node process each for API and worker. Numbers vary ±10% between runs.

### 2.1 HTTP API

50 concurrent connections for 10 s per scenario. Each request is sent as a
different user (500 users per scenario, rotated) so the per-user rate limit is
not what gets measured; each user has 3 applications and the job board has the
dev seed jobs.

| Scenario                          | Requests | req/s | p50 ms | p95 ms | p99 ms | Errors |
|-----------------------------------|----------|-------|--------|--------|--------|--------|
| GET /health                       | 29435    | 2944  | 14.3   | 33.1   | 49.7   | 0      |
| GET /jobs (ranked)                | 2948     | 295   | 159.4  | 256.0  | 326.8  | 0      |
| GET /applications                 | 3662     | 366   | 127.3  | 207.5  | 307.9  | 0      |
| GET /analytics/dashboard (cached) | 10645    | 1065  | 37.3   | 96.2   | 195.6  | 0      |
| GET /analytics/applications       | 4886     | 489   | 95.1   | 143.2  | 207.8  | 0      |
| POST /jobs/:id/save (idempotent)  | 1192     | 119   | 400.6  | 635.7  | 689.8  | 0      |

Zero errors in ~53k requests. The save POST mixed 201s (first save) and 200s
(already saved), every one with a fresh `Idempotency-Key`.

### 2.2 Background pipelines

2000 items pushed in one burst, measured until every item finished.

| Pipeline                       | Items | Seconds | Items/s | p50 ms | p95 ms | p99 ms |
|--------------------------------|-------|---------|---------|--------|--------|--------|
| outbox → relay → event handler | 2000  | 6.9     | 291     | 3825   | 6926   | 7124   |
| reminder.fire → notification   | 2000  | 7.5     | 268     | 3727   | 7025   | 7487   |

Latency here is "time from insert to done" for a 2000-item burst, so it is
dominated by waiting in the queue (p50 ≈ half the drain time). The per-item
processing time is concurrency ÷ throughput: ~17 ms per domain event
(concurrency 5) and ~37 ms per reminder (concurrency 10, one transaction that
marks the reminder SENT and writes the notification).

---

## 3. Where the bottleneck is

Container CPU was sampled every few seconds during the API run:

| Container | CPU during the run |
|-----------|--------------------|
| api       | 100–135% the whole time, in every scenario |
| postgres  | 50–170%, bursty |
| redis     | < 25% |

**The API process is CPU-bound.** Node runs the request path on one core, and
it sits at one full core in every scenario, while Postgres and Redis have
plenty of spare capacity on a 12-thread machine. Throughput per scenario is
therefore roughly "one core ÷ CPU per request":

- `/health` does almost nothing → ~3k req/s.
- The cached dashboard is one Redis read plus JWT verification → ~1k req/s.
- `/jobs` loads the profile and candidate jobs, then scores, filters and sorts
  them in JavaScript per user → ~300 req/s.
- The idempotent save does the most queries per request: claim the key, check
  the job is visible, upsert the save, store the response. Each Prisma query
  costs API CPU (query building and result mapping happen in-process) → ~120 req/s.

**What this means for V1.** 20 students produce perhaps a few requests per
second at peak. The slowest endpoint has ~50× headroom on one shared core; the
free Render instance (0.1 CPU) still leaves ~5×. The real production latency
floor is network round-trips to Supabase/Upstash, not CPU.

**If it ever needs to scale,** in order:

1. **More API processes.** The API is stateless (JWT auth, rate limits and
   caches in Redis, idempotency in Postgres), so a bigger instance with Node
   cluster / several Render instances scales close to linearly until Postgres
   becomes the limit.
2. **Cache the ranked job list per user** for a short TTL (it already caches
   the public candidate set; scoring is the remaining cost).
3. **Raise worker concurrency** or run more worker instances. Both pipelines
   are idempotent and use row-level locking (`SKIP LOCKED` in the relay), so
   adding workers is safe.
4. **Postgres connection pooling** (Supabase's pooler / PgBouncer) once there
   are several API instances, so connection count stays below the plan limit.

Things deliberately *not* done because the numbers don't justify them:
read replicas, sharding, a message broker other than Redis, or rewriting hot
paths in another language.
