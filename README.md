# Jobyssey

**Your personal placement operating system.** Discover opportunities, track
applications, manage deadlines and interviews, and never miss a placement event.

`React · Node.js · Express · PostgreSQL · Redis · BullMQ · Docker`

![Dashboard](docs/screenshots/dashboard.png)

---

## Status

| Phase | Scope                                   | State        |
|-------|-----------------------------------------|--------------|
| 0     | Design: architecture, schema, API       | ✅ Done      |
| 1     | Foundation: API, worker, DB, Docker, UI shell | ✅ Done |
| 2     | Authentication: signup, login, rotating refresh tokens, rate limits, profile | ✅ Done |
| 3     | Jobs & matching                         | ⏭ Next       |
| 4–9   | Applications, interviews, workers, reliability, documents, analytics | Planned |
| 10    | Testing & load testing                  | Planned      |

Design docs:

- [`docs/architecture.md`](docs/architecture.md) — system design, state machine, outbox, queues, deployment
- [`docs/schema.md`](docs/schema.md) — every table and why it looks the way it does
- [`docs/api.md`](docs/api.md) — REST contract, error codes, idempotency, pagination

---

## Repository layout

```text
backend/              Express API + background worker (one image, two entrypoints)
  prisma/             schema.prisma + migrations
  src/
    config/           env validation (zod), logger, redis
    controllers/      request → service → response
    domain/           pure business rules (application state machine)
    middleware/       request id, errors (auth, rate limit, idempotency next)
    models/           Prisma client
    routes/           HTTP wiring
    services/         business logic
    workers/          background processors (heartbeat today; BullMQ in phase 6)
    server.js         API entrypoint
    worker.js         worker entrypoint
  tests/              Jest + Supertest
frontend/             Vite + React + Tailwind SPA
docs/                 design documents
docker-compose.yml    postgres, redis, migrate, api, worker
```

---

## Running locally

Prerequisites: Node 22+, Docker.

### Option A — everything in Docker

```bash
docker compose up -d --build        # postgres, redis, migrations, api, worker
cd frontend && npm install && npm run dev
```

Open <http://localhost:5173>. The API is on <http://localhost:4001>.

### Option B — API and worker on your machine (hot reload)

```bash
docker compose up -d postgres redis

cd backend
cp .env.example .env
npm install                         # also runs `prisma generate`
npm run db:deploy                   # apply migrations
npm run dev                         # API on :4001
npm run dev:worker                  # in a second terminal

cd ../frontend
npm install
npm run dev                         # http://localhost:5173
```

### Ports

Host ports are offset from the defaults so Jobyssey can run next to other local
stacks. Override them in a root `.env` (see `.env.example`).

| Service  | Host port |
|----------|-----------|
| API      | 4001      |
| Postgres | 5432      |
| Redis    | 6380      |
| Frontend | 5173      |

---

## Useful commands

```bash
# backend/
npm test               # unit + integration tests (needs `docker compose up -d postgres redis`)
npm run db:migrate     # create a migration after editing schema.prisma
npm run db:studio      # browse the database
npm run user:set-role -- you@example.com ADMIN   # promote an account (admins curate public jobs)

# health
curl localhost:4001/api/health          # liveness
curl localhost:4001/api/health/ready    # database, redis, worker heartbeat
```

Integration tests run against a separate `jobyssey_test` database (created and
migrated automatically) and Redis DB 15, so they never touch your dev data.

---

## Deployment (beta)

Frontend on Cloudflare Pages, API on Render, Postgres + file storage on Supabase,
Redis on Upstash. See [architecture §9](docs/architecture.md#9-deployment-beta-0)
for the free-tier caveats (sleeping instances, cross-site cookies, connection
limits) and how the design handles them.
