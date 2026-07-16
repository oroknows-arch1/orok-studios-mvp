# OROK Studios — Production Deployment Runbook (v0.3)

Exact, human-executed steps to deploy the publishing system to the existing
Render application with managed PostgreSQL. **Nothing in this file runs
automatically.** Do not provision infrastructure, change Render settings, or
merge until you have reviewed each step.

Related docs: [`PUBLISHING.md`](./PUBLISHING.md) (system + workflow),
[`DATABASE.md`](./DATABASE.md) (schema, migrations, storage policy). The Render
blueprint is [`render.yaml`](../render.yaml) (documentation of intended topology;
contains no secrets).

Guiding rules:
- Migrations run **once per deploy** via Render's `preDeployCommand`, never
  concurrently from multiple web instances.
- Production **must** use PostgreSQL; the app refuses to start on file/memory
  storage in production (see the storage guard in `DATABASE.md`).
- Secrets (`OPENAI_API_KEY`, `DATABASE_URL`) are set in the Render dashboard,
  never committed.

---

## A. GitHub

1. Review PR #1 in full (generator untouched, no secrets/data committed).
2. Confirm CI results are green (the full `node --test` suite; PostgreSQL
   integration tests require `TEST_DATABASE_URL` in CI — see §F).
3. Merge PR #1 into `main`.
4. Record the merge commit SHA: `__________`.

---

## B. Render PostgreSQL (managed database)

1. Create the managed PostgreSQL database (e.g. from `render.yaml` or the
   dashboard). Provisioning a paid plan requires explicit approval.
2. Record region and plan: region `__________`, plan `__________`.
3. Confirm backup/retention behaviour for the chosen plan (see §G) and record
   the retention window: `__________`.
4. Obtain the **internal** connection string (Render provides an internal URL
   for service-to-database traffic). Do not use or expose the external URL
   publicly.
5. Never paste the connection string into logs, PRs, screenshots, or chat.

---

## C. Render web service

1. Confirm the existing web service points to the correct repository and the
   `main` branch.
2. Add/verify environment variables (values set in the dashboard, not in git):
   - `NODE_ENV=production`
   - `PUBLISHING_STORAGE=postgres`
   - `DATABASE_URL` = the managed database's internal connection string
     (via `fromDatabase` in the blueprint, or pasted as a secret)
   - `OPENAI_API_KEY` = existing secret
   - Leave `PUBLISHING_ALLOW_EPHEMERAL_STORAGE` **unset**.
3. Configure the migration step as the **pre-deploy command**:
   `npm run db:migrate`. (If your plan does not support pre-deploy commands, run
   `npm run db:migrate` as a one-off job against the database **before** the
   deploy that first needs the schema — never from multiple instances at once.)
4. Configure the **build command**: `npm install`.
5. Configure the **start command**: `npm start`.
6. Configure the **health-check path**: `/health`.
7. Trigger a controlled deploy (auto-deploy stays off; a human initiates it).

---

## D. Verification (after deploy)

Run against the database / live service:

```bash
# migration state (expects all applied, "Current: yes")
DATABASE_URL=<internal-url> npm run db:status

# read-only integrity check (expects all PASS, exit 0)
DATABASE_URL=<internal-url> PUBLISHING_STORAGE=postgres npm run publishing:verify

# non-destructive live smoke test (expects all PASS, exit 0)
npm run smoke:test -- --base-url https://<your-service>.onrender.com
```

Then manually verify:
- **Existing generator**: open `/`, generate/preview still works (a real
  generation will call OpenAI — optional and operator-initiated only).
- **Publishing dashboard**: open `/publishing`, dashboard loads.
- **Coffee Break Build #001**: present, `published`, series number 1.
- **Controlled draft persistence across restart**: create a draft in the UI,
  restart the web service from the Render dashboard, confirm the draft is still
  present (proves durable PostgreSQL storage, not ephemeral).

The smoke test creates one archived record labelled
`[DEPLOYMENT SMOKE TEST <id>]`; it is safe to leave or archive/ignore.

---

## E. Health semantics

- `GET /health` — platform health. Returns **200** only when the generator key
  is configured AND publishing storage is ready (DB reachable + migrations
  current). Returns **503** otherwise. Safe fields only.
- `GET /api/publishing/health` — detailed publishing storage readiness
  (`ok`, `storage`, `databaseReachable`, `migrationsCurrent`).

Neither endpoint calls OpenAI or exposes secrets, hostnames, SQL, file paths, or
stack traces.

---

## F. CI note for PostgreSQL integration tests

The suite runs everywhere with `npm test`. Tests that require a real database
are **skipped** unless `TEST_DATABASE_URL` is set. To exercise them in CI,
provision a throwaway PostgreSQL and set `TEST_DATABASE_URL` (the suite
`TRUNCATE`s the table between tests, so never point it at real data).

---

## G. Backups & operator-controlled backup

- **Render PostgreSQL backups**: paid plans include automated daily backups with
  point-in-time recovery within the plan's retention window; the free/hobby
  tier has limited or no retention. Confirm the exact behaviour for your chosen
  plan in the Render dashboard and record it in §B.3.
- **Operator-controlled backup before any destructive future migration**: take a
  manual snapshot first.
  ```bash
  pg_dump "$DATABASE_URL" --no-owner --format=custom --file=orok-publishing-$(date +%Y%m%d-%H%M).dump
  # restore (into a fresh/empty database):
  pg_restore --no-owner --dbname="$TARGET_DATABASE_URL" orok-publishing-YYYYMMDD-HHMM.dump
  ```
- **Cost Ledger v0.1** adds migration `004_publishing_generation_costs.sql`
  (observational text-generation usage table). Run `npm run db:migrate` before
  relying on `/api/publishing/costs/*` in postgres mode. Pricing estimates live
  in `src/publishing/costs/pricing.js` and require manual updates.
- **Current migrations are additive** (create table/indexes only). They do not
  drop or rewrite data, so applying them is low-risk. This section becomes
  mandatory only if a future migration is destructive.

---

## H. Rollback — decision points

Roll the **web app** back by redeploying the previous web revision in Render
(Deploys → pick the prior successful deploy → "Redeploy"/"Rollback"). Record the
previous good revision before deploying: `__________`.

**Rolling the web app back does NOT roll the database back.** The database keeps
whatever migrations/data it has. Because our migrations are additive, an older
web revision generally still works against the newer schema. Before rolling the
web app back, verify compatibility: confirm the older revision does not require a
column/table that a newer migration removed (none exist today — schema is
additive), and run `npm run publishing:verify` against the database.

Decision points:

1. **Application fails before migrations** (build/boot fails, pre-deploy not yet
   run): no schema change happened. Fix config (commonly a missing/invalid
   `DATABASE_URL`, or `PUBLISHING_STORAGE`/`NODE_ENV` mismatch — the app fails
   fast with a clear, non-secret message) and redeploy. No rollback needed.
2. **Migration failure** (pre-deploy `db:migrate` exits non-zero): the deploy
   halts and the previous version keeps serving. The failed migration was not
   recorded (each runs in its own transaction). Fix the cause (e.g. `pg_trgm`
   permission per `DATABASE.md`), then re-run `db:migrate` and redeploy. Do not
   force the app live with a partially-migrated schema.
3. **Application fails after migrations** (schema applied, app unhealthy):
   redeploy the previous web revision. The additive schema remains compatible.
   Investigate via logs and `/health`.
4. **Database outage / unreachable**: the app keeps serving the **generator**;
   publishing endpoints return errors and `/health` + `/api/publishing/health`
   report `databaseReachable: false` (so the platform can route around it). Do
   not switch to file/memory in production to "recover" — that silently loses
   data. Restore database connectivity, then re-verify.
5. **Generator works but publishing fails**: publishing storage/migration issue.
   `/api/publishing/health` shows the cause. Fix DB/migrations; the generator is
   unaffected. If you must hide the Publishing UI temporarily, see §I.
6. **Publishing works but generator fails**: usually a missing/invalid
   `OPENAI_API_KEY`. `/health` shows `generator.available: false`. Restore the
   key; publishing data is unaffected.

---

## I. Temporarily disabling the Publishing navigation (without deleting data)

To hide publishing from users without touching stored data:

- Simplest: stop linking users to `/publishing` (it is a separate page; the
  generator at `/` does not link to it). Existing data in PostgreSQL is
  untouched and returns when you re-enable access.
- The publishing API/data remain intact; nothing is deleted. Re-enable by
  pointing users back to `/publishing`.
- Do **not** switch `PUBLISHING_STORAGE` away from `postgres` to "disable" it —
  that does not delete data but would make the app read a different (empty)
  store and, in production, is blocked by the storage guard anyway.

---

## J. Emergency: database unreachable and you must serve publishing

Only as a last resort, and understanding data will not persist:

1. Set `PUBLISHING_ALLOW_EPHEMERAL_STORAGE=true` and `PUBLISHING_STORAGE=memory`
   (or `file`). The app starts with a loud warning.
2. Treat everything created in this mode as disposable.
3. Switch back to `postgres` and unset the override as soon as the database is
   healthy; re-run `npm run publishing:verify`.
