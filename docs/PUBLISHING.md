# OROK Studios Publishing System (through Draft Generation v0.4)

A review-first publishing workflow layered on top of the existing OROK Studios
post/image generator. It does **not** connect to X (Twitter) and it **never**
publishes anything automatically. "Published" means a human explicitly recorded
that a post went out — nothing more.

As of **v0.4**, drafts can also be **generated** inside the Publishing UI using
the same OpenAI post-generation capability as the Create Post page, then placed
into the review queue for manual approval.

---

## 1. Purpose

The generator produces post ideas and text. The publishing system adds the
missing layer around it: a place to turn ideas into reviewed, approved, and
recorded posts, with an auditable ledger and archive. It answers:

- What am I publishing today (morning / evening / weekend)?
- What is waiting for review or approval?
- What has actually gone out, and when, and where?
- What is the next Coffee Break Build number?
- Is this new draft basically a repeat of something I already did?
- Can I generate a draft from inside Publishing and put it straight into review?

---

## 2. Architecture placement

The publishing system is an **additive module inside the existing Express app**.
It does not replace or fork the application.

```
server.js                     existing app; mounts publishing + shared generator
src/generator/                PostGenerator interface + OpenAI implementation
  index.js                    createPostGenerator(); shared by /generate + publishing
  openai-post-generator.js    OpenAI-backed generator (+ StubPostGenerator for tests)
  post-utils.js               cleanPost, hashtags, filters (preserved behaviour)
src/publishing/
  constants.js                streams, statuses, transition table, rhythm
  validation.js               item + request-body validation (ValidationError)
  transitions.js              legal status-transition rules (TransitionError)
  numbering.js                Coffee Break Build number calculation
  similarity.js               deterministic, advisory duplicate detection
  model.js                    PublishingItem factory + history snapshots
  repository.js               repository interface + in-memory & file adapters
  service.js                  business rules; seeds Coffee Break Build #001
  generation-service.js       Draft Generation v0.4 (Publishing → PostGenerator)
  routes.js                   Express router (mounted at /api/publishing)
  index.js                    wires repository + service + generation + router
  ui/index.html               self-contained single-page UI (served at /publishing)
test/                         node:test suites (unit, service, HTTP integration)
```

### Draft Generation flow (v0.4) — OROK editorial system

```
Publishing schedule / explicit category
→ resolve today’s stream and post type
→ load canonical OROK editorial profile (src/editorial)
→ OrokPromptBuilder (core voice + profile + surface + grounding)
→ PostGenerator
→ validate against profile
→ draft candidates
→ review queue
```

**No publishing generation request may proceed without a resolved editorial
profile.** Missing profile → explicit error (never generic fallback).

Canonical editorial source of truth: `src/editorial/`
(profiles, voice, schedule, formatting, prompt-builder, validation, examples).

Safety rules for generation:

- Generated items start as `draft`, then are submitted to `review` by default.
- Generation **never** auto-approves.
- Generation **never** marks an item published.
- There is **no** X / network publishing from this path.
- Manual draft creation (`POST /items`) remains fully supported.
- Cultural / Masters / Coffee Break Build profiles require factual `grounding`.
- Family message and X are distinct output surfaces (not one post trimmed twice).

Historical approved OROK examples should be imported next into
`src/editorial/examples/` (labelled by profile, surface, quality, topic, date).
Do not invent a two-year archive.

The legacy Create Post routes (`/generate`, `/generate-image`, `/analyze-voice`)
keep working. `/generate` uses the same canonical editorial `PostGenerator`.

---

## 3. Storage choice

Storage lives behind a **repository interface** (`PublishingRepository`) with
three adapters (as of Persistence v0.2):

| Adapter | Use | Persistence |
| --- | --- | --- |
| `InMemoryPublishingRepository` | isolated tests, ephemeral dev | lost on restart |
| `FilePublishingRepository` | local development / migration testing | JSON file (atomic writes) |
| `PostgresPublishingRepository` | **deployed production** | managed PostgreSQL |

Selected via environment:

- `PUBLISHING_STORAGE` = `postgres` \| `file` (default) \| `memory`
- `DATABASE_URL` = postgres connection string (**required** for `postgres`)
- `PUBLISHING_DATA_FILE` = path to the JSON file (file mode; default `./data/publishing.json`)

Rules:

- `postgres` **requires** `DATABASE_URL`; missing/invalid → the app **fails
  clearly at startup**.
- There is **no silent fallback** from `postgres` to `file`/`memory`.
- Credentials / connection strings are never logged.

The file adapter remains for local development and migration testing; the
in-memory adapter remains for isolated tests. Full database details, migrations,
import, deployment order, and rollback are in [`DATABASE.md`](./DATABASE.md).

### Render implications (IMPORTANT)

Render's default filesystem is **ephemeral** — wiped on every deploy/restart — so
the JSON file adapter is **development-only** and must not be used as production
persistence on Render. Production uses the **PostgreSQL adapter** with a managed
database (`PUBLISHING_STORAGE=postgres` + `DATABASE_URL`). Do not provision paid
infrastructure without human approval.

Because storage is behind the interface, the service, routes, and UI did not
change when PostgreSQL was added — only a new adapter was introduced.

---

## 4. Local setup

```bash
npm install
npm start            # serves on http://localhost:3000
```

Then open:

- Generator (existing):  http://localhost:3000/
- Publishing system:     http://localhost:3000/publishing

Run tests (the full suite):

```bash
npm test
```

Environment variables:

| Variable | Required | Purpose |
| --- | --- | --- |
| `OPENAI_API_KEY` | for the generator only | existing post/image generation |
| `PORT` | no (default 3000) | server port |
| `PUBLISHING_STORAGE` | no (default `file`) | `postgres` \| `file` \| `memory` |
| `DATABASE_URL` | yes when `postgres` | postgres connection string |
| `PUBLISHING_DATA_FILE` | no | path to the JSON data file (file mode) |

The publishing system itself needs **no API key** — manual draft creation and the
whole review workflow work offline.

Database & operations commands (postgres mode — see [`DATABASE.md`](./DATABASE.md)
and [`DEPLOYMENT.md`](./DEPLOYMENT.md)):

```bash
npm run db:migrate                                             # apply migrations
npm run db:status                                              # migration status
npm run publishing:import-file -- --file ./data/publishing.json --dry-run
npm run publishing:verify                                      # read-only integrity check
npm run smoke:test -- --base-url https://your-service.onrender.com
```

Health endpoints:
- `GET /health` — general application readiness for the platform (Render). 200
  only when the generator is configured and publishing storage is ready;
  otherwise 503. Safe fields only.
- `GET /api/publishing/health` — detailed publishing storage readiness.

---

## 5. Status workflow

Canonical happy path:

```
idea -> draft -> review -> approved -> published -> archived
```

Plus `rejected`, reachable from any active state. Legal transitions:

| From | Allowed to |
| --- | --- |
| idea | draft, review, rejected, archived |
| draft | review, rejected, archived |
| review | approved, draft, rejected, archived |
| approved | published, review, draft, rejected, archived |
| published | archived |
| archived | (terminal) |
| rejected | (terminal — preserved, never silently recreated) |

Status is **never** changed by a plain `PATCH`. It changes only through the
explicit transition endpoints (`submit`, `approve`, `reject`, `publish`,
`archive`).

---

## 6. Coffee Break Build numbering rule

- Public numbers advance **only when the previous entry is `published`**.
- The next number is `highestPublishedNumber + 1`.
- A draft may **reserve** the next number, but a reservation held by an
  `idea`/`draft`/`review`/`approved` item is a **soft** reservation.
- If that item is **rejected or archived without publishing**, the number is
  **released** and can be reused — a rejected/abandoned draft never permanently
  consumes a number.
- Published numbers are **permanent** and are never renumbered.

Seeded record: **Coffee Break Build #001 — published 2026-07-15**. Its final text
and post URL are intentionally left empty/unresolved.

---

## 7. Manual approval rule (safety)

- The system **never automatically publishes**.
- A generated post is **never** auto-approved (v0.4 places it in `review` only).
- An approved post is **never** marked published without an explicit
  `publish` action carrying confirmation.
- Rejected entries are preserved with a required reason.
- Text edits bump the `version` and append a history snapshot for audit.
- Published Coffee Break Build entries are never silently renumbered.

---

## 8. Duplicate prevention (advisory only)

A deterministic check compares a new draft against existing items across five
dimensions: **topic, opening, central lesson, example, image concept**. If at
least **three** dimensions substantially match another single item, the draft is
**flagged** in the UI/API response. This is purely advisory — it never rejects,
deletes, or mutates a draft, and it uses no embeddings or external AI calls.

---

## 9. Default publishing rhythm (planning metadata only)

| Day | Morning | Evening |
| --- | --- | --- |
| Mon–Fri | OROK Morning | Coffee Break Build |
| Saturday | Saturday Mixed Pack (all day) | |
| Sunday | Sunday Long Game (all day) | |

In v0.1 this rhythm is **metadata only**. There is no scheduler and no unattended
generation.

---

## 10. Future X integration boundary

One-click X publishing is intentionally **out of scope** for v0.1. The current
`publish` action only *records* that a post went out (date/time, URL, final
text). A future integration would:

1. Add an X API client behind a server-side adapter (keys stay server-side —
   never exposed to the frontend).
2. Extend the `publish` action to optionally call X and store the returned
   post URL, while keeping the manual "record only" path available.
3. Require explicit per-post confirmation before any network publish.

Automatic scheduled generation is also out of scope; it would require a
persistent store (see §3) and a vetted scheduler before it could run unattended.

---

## 11. API reference

Base path: `/api/publishing`

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/items` | list items (filters: `stream`, `status`, `date`, `topic`) |
| GET | `/items/:id` | get one item |
| POST | `/items` | create a draft/idea (returns `duplicateAdvisory`) |
| PATCH | `/items/:id` | edit editable fields (not status) |
| POST | `/items/:id/submit` | draft/idea → review |
| POST | `/items/:id/approve` | review → approved |
| POST | `/items/:id/reject` | → rejected (requires `{ reason }`) |
| POST | `/items/:id/publish` | approved → published (requires `{ confirm: true }`) |
| POST | `/items/:id/archive` | → archived |
| GET | `/dashboard` | dashboard summary |
| GET | `/next-number?stream=` | suggested next series number |
| POST | `/check-duplicates` | advisory duplicate check for a candidate |
| POST | `/generate/resolve` | **v0.4** resolve editorial profile/surface/schedule (no OpenAI) |
| POST | `/generate/preview` | **v0.4** generate OROK candidates (requires resolved profile) |
| POST | `/generate` | **v0.4** create draft from generation/selection → review queue |
| GET | `/health` | storage readiness (safe fields only; 200 ok / 503 not) |

### Generation request bodies (v0.4)

`POST /generate/preview`:

```json
{ "idea": "consistency", "category": "Motivation Monday", "weeklyPosts": "optional" }
```

`POST /generate`:

```json
{
  "stream": "orok-morning",
  "plannedDate": "2026-07-16",
  "idea": "consistency",
  "category": "Motivation Monday",
  "selectedIndex": 0,
  "placeInReview": true,
  "text": "optional — when set, skips OpenAI and uses this body"
}
```

Response includes `{ item, candidates, selectedIndex, duplicateAdvisory }`.
`item.status` is `review` when `placeInReview` is true (default), otherwise `draft`.
Missing generator configuration returns **503**.

`GET /api/publishing/health` returns only safe information and never exposes
credentials, hostnames, SQL, stack traces, or file paths:

```json
{ "ok": true, "storage": "postgres", "databaseReachable": true, "migrationsCurrent": true }
```

The main app still serves the existing generator even when publishing storage is
unhealthy, unless the selected repository cannot be safely initialised at startup
(e.g. `postgres` selected without a valid `DATABASE_URL`).

All request bodies are validated; validation failures return `400` with an
`errors` array, illegal transitions return `409`.
