# OROK Studios Publishing — Database (Persistence v0.2)

This document covers the PostgreSQL production adapter for the publishing
system. The overall publishing design, status workflow, numbering rule, and
safety rules live in [`PUBLISHING.md`](./PUBLISHING.md). Nothing here changes
those rules — it only changes where the data is stored.

---

## 1. Why PostgreSQL is the production adapter

The v0.1 JSON file store is development-only: Render's default filesystem is
**ephemeral**, so file data is lost on every redeploy/restart. PostgreSQL gives
durable, transactional storage with the two guarantees the publishing rules
need under real concurrency:

- **Atomic, row-locked status transitions** (no lost updates).
- **A partial unique index** that makes duplicate *published* Coffee Break Build
  numbers impossible, even across multiple app instances.

PostgreSQL is a managed, widely-available service on Render and elsewhere. We
use the lightweight [`pg`](https://node-postgres.com/) client (node-postgres) —
**no ORM** — with explicit SQL and a tiny migration layer, matching the existing
plain CommonJS/Express style.

---

## 2. Repository architecture

The dependency direction is unchanged from v0.1:

```
Routes -> Publishing Service -> Publishing Repository Interface -> Adapter
```

- `src/publishing/repository-interface.js` — the `PublishingRepository` contract.
- `src/publishing/repository.js` — `InMemory` + `File` adapters and the
  environment-driven factory (`createRepositoryFromEnv`).
- `src/publishing/db/postgres-repository.js` — the PostgreSQL adapter.
- `src/publishing/db/pool.js` — pool creation + `DATABASE_URL` validation + TLS.
- `src/publishing/db/mapper.js` — row ↔ model translation (keeps snake_case and
  SQL types out of the service/routes).
- `src/publishing/db/migrate.js` + `migrations/*.sql` — the migration runner.
- `src/publishing/db/cli.js` — `db:migrate` / `db:status` CLI.
- `src/publishing/db/import-file.js` — JSON-file → PostgreSQL importer.

The service and routes never see SQL or PostgreSQL types.

---

## 3. Required environment variables

| Variable | Modes | Meaning |
| --- | --- | --- |
| `NODE_ENV` | all | `production` enforces the storage policy below |
| `PUBLISHING_STORAGE` | all | `memory` \| `file` \| `postgres` (default `file`) |
| `DATABASE_URL` | `postgres` (**required**) | `postgres://user:pass@host:5432/db` |
| `PUBLISHING_DATA_FILE` | `file` (optional) | path to the JSON store |
| `PUBLISHING_ALLOW_EPHEMERAL_STORAGE` | emergency only | set `true` to permit memory/file when `NODE_ENV=production` (default disabled) |
| `DATABASE_SSL` | `postgres` (optional) | `true`/`false` to force TLS on/off |
| `PGPOOL_MAX` | `postgres` (optional) | max pool connections (default 10) |
| `TEST_DATABASE_URL` | tests only | enables PostgreSQL integration tests |

**Production storage guard:** when `NODE_ENV=production`, selecting
`PUBLISHING_STORAGE=file` or `memory` makes the app refuse to start (clear,
credential-free error). This prevents accidentally running on Render's ephemeral
filesystem. In a genuine emergency you may set
`PUBLISHING_ALLOW_EPHEMERAL_STORAGE=true`, which permits it but logs a prominent
warning that data will not survive a restart. Leave it unset normally.

**Operational commands:** `npm run publishing:verify` runs a read-only integrity
check (repository reachable, migrations current, seed present/published/#1, no
duplicate published numbers, all records valid, dashboard executes) and exits
non-zero on failure. `npm run smoke:test -- --base-url <url>` runs a
non-destructive post-deploy check (see docs/DEPLOYMENT.md).

Behaviour:

- `postgres` **requires** `DATABASE_URL`. If it is missing or malformed, the app
  **fails clearly at startup** with a credential-free message.
- There is **no silent fallback** from `postgres` to `file`/`memory`.
- The connection string and credentials are **never logged**. TLS defaults to
  off for `localhost`/`127.0.0.1` and on for remote hosts (Render requires TLS);
  override with `DATABASE_SSL` or a `sslmode=` query parameter.

---

## 4. Local PostgreSQL setup

Any local PostgreSQL 14+ works. Example with a locally-initialised cluster:

```bash
# create a database
createdb orok_publishing

# point the app at it
export PUBLISHING_STORAGE=postgres
export DATABASE_URL="postgres://<you>@127.0.0.1:5432/orok_publishing"

# create the schema
npm run db:migrate
npm run db:status     # should show all migrations applied and "Current: yes"

# run the app
npm start             # http://localhost:3000/publishing
```

To run the PostgreSQL integration tests, set `TEST_DATABASE_URL` to a database
you are happy to have **truncated**, then `npm test`:

```bash
export TEST_DATABASE_URL="postgres://<you>@127.0.0.1:5432/orok_publishing_test"
npm test
```

Without `TEST_DATABASE_URL`, those tests are **skipped** (not failed), so the
suite still runs everywhere.

---

## 5. Migrations

Migrations are ordered `.sql` files in `src/publishing/db/migrations/`, applied
once each, recorded in a `publishing_migrations` table. They are safe to run
repeatedly, each runs in its own transaction, and a failure exits non-zero
leaving the schema at the last successful migration.

```bash
npm run db:migrate    # apply all pending migrations
npm run db:status     # list applied/pending migrations; shows if current
```

Application startup **never** runs or rewrites migrations — it only seeds data
(see §7). Run `db:migrate` explicitly as a deploy step.

| Migration | Contents |
| --- | --- |
| `001_create_publishing_items.sql` | table + `version >= 1` and positive-series-number checks |
| `002_publishing_items_indexes.sql` | partial unique index on published CBB numbers + status/stream/date indexes |
| `003_publishing_topic_search.sql` | `pg_trgm` extension + trigram indexes for topic/category search |
| `004_long_game_sources.sql` | `macro_signal`, `family_lesson`, `sources` JSONB on items + `publishing_long_game_sources` child table for searchable source metadata |

### pg_trgm policy (deterministic)

Migration `003` runs `CREATE EXTENSION IF NOT EXISTS pg_trgm;` and then creates
trigram GIN indexes. This is **deterministic**, not "best effort":

- If the connected role can create/use `pg_trgm`, `003` applies and is recorded.
- If the role **cannot**, `003` fails inside its own transaction, is **not
  recorded**, `npm run db:migrate` exits non-zero, and `npm run db:status`
  continues to report it as **pending** (never an ambiguous "skipped while
  current"). On Render, the `preDeployCommand` then fails and the deploy halts.

Managed PostgreSQL on Render permits `pg_trgm` for the default role, so `003`
normally applies cleanly. If you deploy to a provider that forbids it, do **one**
of the following before deploying — never leave `003` half-applied:

1. Grant the role permission (or have an admin `CREATE EXTENSION pg_trgm` once),
   then re-run `npm run db:migrate`; or
2. Adopt the no-extension fallback: replace `003` with a migration that creates
   plain btree indexes on `lower(topic)`/`lower(category)`. Topic search still
   works via `ILIKE`; the trade-off is that leading-wildcard substring searches
   (`%term%`) do a sequential scan instead of a fast trigram index lookup. At the
   current data volumes this is negligible.

Because migrations are immutable-by-name and recorded on success, any local
development database where `003` already applied keeps working unchanged.

### Schema (publishing_items)

`id (PK, text)`, `stream`, `series_number (int, nullable)`, `planned_date
(date)`, `generated_at/updated_at/published_at/created_at (timestamptz)`,
`status`, `category`, `topic`, `dominant_pattern`, `macro_signal`,
`family_lesson`, `sources (jsonb)`, `version (int, CHECK >= 1)`,
`text`, `image_required (bool)`, `image_brief`, `post_url`, `rejection_reason`,
`notes`, `similarity_opening/central_lesson/example/image_concept`, `history
(jsonb)`. Nullable fields remain nullable; timestamps are timezone-aware
(stored UTC); `planned_date` is a calendar date.

### Schema (publishing_long_game_sources)

Child table for Sunday Long Game source metadata (Amendment 001). Cascades on
item delete. Columns: `id`, `item_id` (FK), `title`, `url`, `publisher`,
`publication_date`, `access_date`, `topic`, `category`, `created_at`. Indexed
for search by publisher, topic, access year, and URL. The denormalised
`publishing_items.sources` JSONB remains the single-row read path; this table
is the searchable authority for historical source queries.

### Indexes / constraints

- `uq_publishing_published_cbb_series` — **partial UNIQUE** on `series_number`
  `WHERE status='published' AND stream='coffee-break-build'`. This is the
  authoritative guard against duplicate published numbers and intentionally does
  **not** restrict drafts (two drafts may temporarily reserve the same next
  number).
- btree indexes on `status`, `stream`, `planned_date`, `published_at`, and a
  partial index on CBB `series_number`.
- trigram GIN indexes on `topic`/`category` (migration `003`).
- `CHECK (version >= 1)` and `CHECK (series_number IS NULL OR series_number >= 1)`.

Stream and status values are validated at the **application boundary**
(`validation.js`), not by DB enum constraints, so the vocabulary can evolve
without a migration.

---

## 6. Importing the existing file store

Copy an existing JSON file store into PostgreSQL with an explicit, transactional
importer. It is **never run automatically**.

```bash
# preview only — commits nothing
npm run publishing:import-file -- --file ./data/publishing.json --dry-run

# real import
npm run publishing:import-file -- --file ./data/publishing.json
```

Guarantees:

- Every record is validated. If **any** record is invalid, the whole import is
  rolled back (no partial import) and the command exits non-zero.
- Records whose `id` already exists are **skipped** safely.
- IDs, versions, dates, statuses, text, and metadata are preserved as-is.
- `--dry-run` always rolls back and reports what *would* happen.
- The source file is never modified.
- Reports `total / imported / skipped / failed` counts.

---

## 7. Seed behaviour

The confirmed record **Coffee Break Build #001 — published 2026-07-15** (final
text and post URL intentionally unresolved) is seeded by the **service** at
startup, so it works identically for `memory`, `file`, and `postgres`.

Detection is idempotent and non-destructive:

1. It looks up the stable id `seed-coffee-break-build-001`. If present, seeding
   is a no-op (later manual edits are preserved — the seed never overwrites an
   existing record).
2. As a fallback it checks for any published `coffee-break-build` item with
   `series_number = 1`.

Seeding is data, not schema, so it is not a SQL migration.

---

## 8. Concurrency & integrity

- **Atomic transitions** — status changes go through `repository.atomicUpdate`,
  which in PostgreSQL runs `BEGIN; SELECT ... FOR UPDATE; UPDATE; COMMIT`. A
  concurrent writer cannot overwrite a newer version.
- **Atomic publish** — validate transition → confirm number → set published
  state/timestamp/URL → commit, all in one transaction.
- **No duplicate published numbers** — enforced by the partial unique index; a
  losing concurrent publish surfaces as a `409` conflict.
- **Draft numbering stays flexible** — two drafts may briefly suggest the same
  next number; a number is only *consumed* when an item is **published**.

---

## 9. Production deployment order (do NOT execute without approval)

1. **Provision PostgreSQL** (managed instance; do not create paid infra without
   human approval).
2. Set `DATABASE_URL` on the service (secret).
3. Set `PUBLISHING_STORAGE=postgres`.
4. Run `npm run db:migrate`.
5. Verify with `npm run db:status` (all applied, `Current: yes`).
6. Check `GET /api/publishing/health` → `{ ok: true, storage: "postgres",
   databaseReachable: true, migrationsCurrent: true }`.
7. Deploy the application.
8. Verify the existing generator endpoints still work (`/`, `/generate`,
   `/generate-image`, `/analyze-voice`).
9. Verify the publishing dashboard (`/api/publishing/dashboard`, `/publishing`).
10. Verify Coffee Break Build #001 is present and `published`.
11. Create then archive/delete a controlled test draft.
12. Restart the service and confirm the data survives.

(If migrating existing local data, run the file import from §6 between steps 5
and 6.)

---

## 10. Rollback

If PostgreSQL must be rolled back:

1. Redeploy the previous application revision, **or**
2. Temporarily set `PUBLISHING_STORAGE=file` (accepting that Render file storage
   is ephemeral — development/emergency only) or `memory`.
3. Because we **never** silently fall back, switching stores is always an
   explicit configuration change.
4. Schema rollback: migrations are additive; to fully reset a non-production
   database, drop `publishing_items` and `publishing_migrations` and re-migrate.
   Do **not** drop tables on a database holding real data — take a backup first.

**Returning to file storage locally:** unset `DATABASE_URL`, set
`PUBLISHING_STORAGE=file` (optionally `PUBLISHING_DATA_FILE`), and restart. Data
in PostgreSQL is untouched by this switch.

---

## 11. Backups & responsibility

Backups are the deploying operator's responsibility. Use the database provider's
automated backups (Render Postgres includes daily backups on paid plans) and/or
periodic `pg_dump`. This repository does not manage or schedule backups.

**Why production must never silently fall back:** silently switching from
PostgreSQL to an ephemeral file/memory store would appear to "work" while
quietly losing every publish and every approval on the next restart, and could
re-suggest already-consumed Coffee Break Build numbers. Failing loudly is the
safe behaviour.
