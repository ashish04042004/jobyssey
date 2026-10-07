# Jobyssey — Database Schema

PostgreSQL 16. The executable definition is `backend/prisma/schema.prisma`; this
document explains the *why*.

Conventions:

- Primary keys are UUIDs.
- Table and column names are `snake_case` (Prisma models map to them).
- All timestamps are `timestamptz`.
- Soft delete (`deleted_at`) only where a user-facing "undo" or a history
  reference makes sense (documents, applications).
- Every user-owned table carries `user_id` and is indexed by it.

---

## Entity relationships

```text
organizations 1─┬─* users
                └─* jobs

users 1─┬─* applications *─1 jobs *─1 companies
        ├─* documents          │
        ├─* interviews         ├─* application_events (timeline)
        ├─* reminders          ├─* interviews
        ├─* notifications      ├─* prep_items
        ├─* refresh_tokens     └─0..1 documents (resume used)
        ├─* idempotency_keys
        └─* audit_logs (actor)

outbox_events (standalone, written in the same tx as business changes)
```

---

## Tables

### organizations *(schema-ready, unused in V1)*
| Column      | Type        | Notes            |
|-------------|-------------|------------------|
| id          | uuid PK     |                  |
| name        | text        |                  |
| slug        | text UNIQUE |                  |
| created_at  | timestamptz |                  |

### users
| Column              | Type          | Notes |
|---------------------|---------------|-------|
| id                  | uuid PK       | |
| organization_id     | uuid NULL FK  | Phase 2 expansion (colleges) |
| email               | citext-like   | stored lower-cased, UNIQUE |
| password_hash       | text          | argon2id |
| role                | enum `STUDENT \| ADMIN` | default STUDENT |
| name                | text          | |
| college             | text          | |
| degree              | text NULL     | e.g. B.Tech |
| branch              | text          | e.g. CSE |
| graduation_year     | int           | |
| preferred_roles     | text[]        | e.g. `{SDE,Backend}` |
| preferred_locations | text[]        | e.g. `{Delhi NCR,Remote}` |
| min_ctc_lpa         | numeric(6,2) NULL | |
| skills              | text[]        | |
| last_login_at       | timestamptz NULL | used for WAU metric |
| created_at / updated_at | timestamptz | |

### refresh_tokens
| Column       | Type         | Notes |
|--------------|--------------|-------|
| id           | uuid PK      | |
| user_id      | uuid FK      | cascade delete |
| token_hash   | text UNIQUE  | SHA-256 of the opaque token |
| family_id    | uuid         | all rotations of one login share a family |
| expires_at   | timestamptz  | |
| revoked_at   | timestamptz NULL | |
| replaced_by_id | uuid NULL  | next token in the rotation chain |
| user_agent, ip | text NULL  | shown in "active sessions" later |
| created_at   | timestamptz  | |

Index: `(user_id)`, `(family_id)`.
Reuse of a revoked token ⇒ revoke every token in its `family_id`.

### companies
| Column      | Type          | Notes |
|-------------|---------------|-------|
| id          | uuid PK       | |
| name        | text          | |
| slug        | text UNIQUE   | normalised name, dedupes "Microsoft"/"microsoft " |
| website     | text NULL     | |
| logo_url    | text NULL     | |
| description | text NULL     | |
| created_at / updated_at | timestamptz | |

### jobs
| Column               | Type           | Notes |
|----------------------|----------------|-------|
| id                   | uuid PK        | |
| company_id           | uuid FK        | |
| organization_id      | uuid NULL FK   | |
| created_by_id        | uuid NULL FK users | |
| visibility           | enum `PUBLIC \| PRIVATE` | PRIVATE = added by a student for themselves |
| title                | text           | "Software Engineer" |
| role_category        | text NULL      | normalised: SDE, Backend, Frontend, Data, ... (used by matching) |
| employment_type      | enum `FULL_TIME \| INTERNSHIP \| INTERNSHIP_PPO` | |
| locations            | text[]         | |
| is_remote            | bool           | |
| ctc_min_lpa / ctc_max_lpa | numeric(6,2) NULL | |
| eligibility          | text NULL      | free text (CGPA cut-offs, branches) |
| graduation_years     | int[]          | empty = open to all |
| application_deadline | timestamptz NULL | |
| job_url              | text NULL      | |
| description          | text NULL      | |
| is_active            | bool           | admin can close a listing |
| created_at / updated_at | timestamptz | |

Indexes: `(visibility, is_active, application_deadline)`, `(company_id)`,
`(created_by_id)`. Search in V1 uses `ILIKE` on title/company — fine at this
scale; a `pg_trgm` index is the next step, not Elasticsearch.

### applications
| Column       | Type           | Notes |
|--------------|----------------|-------|
| id           | uuid PK        | |
| user_id      | uuid FK        | |
| job_id       | uuid FK        | |
| status       | enum (see state machine) | default SAVED |
| applied_at   | timestamptz NULL | set on first transition to APPLIED |
| notes        | text NULL      | |
| resume_id    | uuid NULL FK documents | "which resume did I use?" |
| version      | int            | optimistic lock, default 0 |
| status_changed_at | timestamptz | for "you haven't updated X" nudges |
| deleted_at   | timestamptz NULL | |
| created_at / updated_at | timestamptz | |

Constraints / indexes:
- `UNIQUE (user_id, job_id)` — one application per job per user; this is the
  DB-level guarantee behind the idempotent "Apply" button.
- `(user_id, status)` — pipeline counts on the dashboard.

Status enum: `SAVED, APPLIED, OA, OA_COMPLETED, INTERVIEW, OFFER, ACCEPTED,
REJECTED, WITHDRAWN`. "Save job" simply creates an application in `SAVED`.

### application_events *(timeline, append-only)*
| Column         | Type          | Notes |
|----------------|---------------|-------|
| id             | uuid PK       | |
| application_id | uuid FK       | cascade delete |
| actor_id       | uuid NULL FK users | |
| from_status    | enum NULL     | NULL for the creation event |
| to_status      | enum          | |
| note           | text NULL     | |
| occurred_at    | timestamptz   | user can back-date ("I applied on Oct 2") |
| created_at     | timestamptz   | |

Index: `(application_id, occurred_at)`. Analytics funnels are computed from this
table.

### interviews *(OA / interview / HR events)*
| Column         | Type          | Notes |
|----------------|---------------|-------|
| id             | uuid PK       | |
| application_id | uuid FK       | cascade delete |
| user_id        | uuid FK       | denormalised for cheap "my upcoming events" queries |
| type           | enum `OA \| TECHNICAL \| HR \| MANAGERIAL \| GROUP_DISCUSSION \| OTHER` | |
| title          | text NULL     | "Round 2 — System design" |
| scheduled_at   | timestamptz   | start time, or OA window open |
| ends_at        | timestamptz NULL | OA deadline / interview end |
| meeting_url    | text NULL     | |
| notes          | text NULL     | |
| status         | enum `SCHEDULED \| COMPLETED \| CANCELLED` | |
| reminder_offsets_minutes | int[] | default `{1440,60}` (24h and 1h before) |
| created_at / updated_at | timestamptz | |

Index: `(user_id, scheduled_at)`.

### reminders
| Column      | Type          | Notes |
|-------------|---------------|-------|
| id          | uuid PK       | also the BullMQ jobId |
| user_id     | uuid FK       | |
| entity_type | text          | `interview` \| `application` \| `job` |
| entity_id   | uuid          | |
| target_at   | timestamptz   | the deadline/event time this reminder is about |
| remind_at   | timestamptz   | when to fire |
| status      | enum `PENDING \| QUEUED \| SENT \| CANCELLED \| FAILED` | |
| job_key     | text UNIQUE   | e.g. `interview:<id>:1440` — idempotent creation |
| attempts    | int           | |
| last_error  | text NULL     | |
| created_at / updated_at | timestamptz | |

Index: `(status, remind_at)` — used by the sweep.

### documents
| Column       | Type          | Notes |
|--------------|---------------|-------|
| id           | uuid PK       | |
| user_id      | uuid FK       | |
| label        | text          | "Resume — Backend" |
| type         | enum `RESUME \| COVER_LETTER \| OTHER` | |
| filename     | text          | original name |
| mime_type    | text          | allow-list: pdf, docx |
| size_bytes   | int           | ≤ 5 MB |
| storage_key  | text UNIQUE   | `users/<userId>/<uuid>.pdf` |
| status       | enum `PENDING \| READY` | PENDING until the direct upload is confirmed |
| deleted_at   | timestamptz NULL | soft delete keeps old applications' `resume_id` meaningful |
| created_at   | timestamptz   | |

Files never go into Postgres.

### prep_items
| Column         | Type     | Notes |
|----------------|----------|-------|
| id             | uuid PK  | |
| application_id | uuid FK  | cascade delete |
| topic          | text     | "Graphs", "OS", "Behavioral" |
| is_done        | bool     | |
| position       | int      | ordering |
| created_at / updated_at | timestamptz | |

Unique: `(application_id, topic)`.

### notifications
| Column     | Type          | Notes |
|------------|---------------|-------|
| id         | uuid PK       | |
| user_id    | uuid FK       | |
| type       | enum `DEADLINE \| INTERVIEW \| JOB_MATCH \| STALE_APPLICATION \| SYSTEM` | |
| title      | text          | |
| body       | text NULL     | |
| link       | text NULL     | in-app route, e.g. `/applications/<id>` |
| dedupe_key | text NULL     | e.g. reminder `job_key`, `job_match:<jobId>` |
| read_at    | timestamptz NULL | |
| created_at | timestamptz   | |

Constraints / indexes: `UNIQUE (user_id, dedupe_key)` (a retried worker job can't
create a duplicate notification), `(user_id, read_at, created_at DESC)`.

### audit_logs *(append-only)*
| Column      | Type        | Notes |
|-------------|-------------|-------|
| id          | uuid PK     | |
| actor_id    | uuid NULL FK users | NULL for system/worker actions |
| action      | text        | `application.created`, `application.status_changed`, `document.attached`, `interview.scheduled`, `auth.login`, ... |
| entity_type | text        | |
| entity_id   | uuid NULL   | |
| metadata    | jsonb       | e.g. `{ "from": "APPLIED", "to": "OA" }` |
| ip          | text NULL   | |
| request_id  | text NULL   | ties an audit row to log lines |
| created_at  | timestamptz | |

Indexes: `(entity_type, entity_id)`, `(actor_id, created_at)`.

### outbox_events
| Column        | Type        | Notes |
|---------------|-------------|-------|
| id            | uuid PK     | used as the BullMQ jobId |
| type          | text        | `application.status_changed`, ... |
| aggregate_type| text        | |
| aggregate_id  | uuid        | |
| payload       | jsonb       | |
| published_at  | timestamptz NULL | NULL = not yet relayed |
| attempts      | int         | |
| created_at    | timestamptz | |

Index: `(published_at, created_at)` — the relay's `published_at IS NULL ORDER BY
created_at` scan is an index range scan. (A partial index `WHERE published_at IS
NULL` would be tighter, but Prisma can't declare it without schema drift; not
worth it at this scale.) Published rows older than 7 days are pruned by the worker.

### idempotency_keys
| Column        | Type        | Notes |
|---------------|-------------|-------|
| id            | uuid PK     | |
| user_id       | uuid FK     | |
| key           | text        | client-supplied `Idempotency-Key` |
| method, path  | text        | |
| request_hash  | text        | SHA-256 of the canonical JSON body |
| status        | enum `IN_PROGRESS \| COMPLETED` | |
| response_code | int NULL    | |
| response_body | jsonb NULL  | |
| locked_at     | timestamptz | stale IN_PROGRESS rows (> 30 s) may be retaken |
| expires_at    | timestamptz | 24 h |
| created_at    | timestamptz | |

Unique: `(user_id, key)`.

---

## Sizing sanity check (20 users)

20 users × ~100 applications × ~6 events ≈ 12k timeline rows. Notifications,
audit logs and outbox rows are each well under 100k rows/year. Supabase's
500 MB free tier is two to three orders of magnitude more than needed; the
pruning jobs exist to keep habits right, not because space is tight.
