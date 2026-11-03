# Eight original posts per Sydney day

Authoritative audience implementation: PR #27 / `feature/emradar-grok-audience-pilot`.
PR #26's independent read-only poller and PR #28's owner-review isolation invariant
are reused. This refinement targets PR #27; it is not permission to merge or enable it.

`createIndependentAudience` composes the existing review, CAS store, X transport,
post reservations and Grok research. Invoke it independently of V3. It has no
startup, polling, notification or publication hook in V3. The restored protected
server/runtime and review files match current repository main. The audience review page
is now a separate export, with exact text, saved graphics, source links, exclusions,
editing, presentation and exact-manifest approval. An independently hosted controller
must map its authenticated actions to the existing review API contract; it is not
mounted into the V3 HTTP server.

Supply an audience-owned pool, SELECT-only upstream source/session readers, the
existing secret-validating owner authenticator, verified published bytes and the
existing X adapter. Source import copies only the scan and saved X graphic into
`emradar_audience_state`. Audience writes cannot target upstream session keys.
Production database-role grants and hosting/authentication wiring must be verified
before activation. This PR creates no service or credentials and enables no flags.

Preparation defaults to STANDALONE. One complete source-supported financial finding,
its material caveat, formation state, evidence IDs, original record hash and source
URLs remain attached to each original. Up to eight discoveries qualify. Evidence
state, source depth, quantified consequence and named commercial actors/industries
provide deterministic priority signals. The review records financial/evidence/length
blockers, duplicate angles and priority exclusions; it never silently trims caveats,
splits a discovery into a thread or pads unused capacity. The optional existing
writer adapter takes one batch with Sean Walker's conversational instructions and
must retain the supported finding and caveat. No model calls or spend are added by
default. Owner revisions remain mandatory when source prose is not feed-ready.

Publication rejects legacy thread manifests. A session advisory lock serialises
all originals for an X account across campaigns/processes. The durable reservation
precedes media or tweet submission. Actual complete account history includes
originals outside this worker; replies and retweets do not consume the allowance.
History plus accepted receipts and unresolved attempts must leave a slot below
eight. Unresolved attempts continue consuming allowance across Sydney midnight.
After media upload, approval and the Sydney date/quota are checked again immediately
before POST /2/tweets. Unique account/source/discovery and normalised-text indexes
prevent retries or another campaign from reposting a discovery or exact text.
Legacy unresolved reservations block activation until independently reconciled.
Unconfirmed API outcomes remain ambiguous; they are never reset or blindly retried.
The deployment must make this boundary the sole audience original-post writer.

Full-scan Grok research retains citation, tool, spending and cache gates and still
covers discoveries excluded from individual publication. Replies remain DRAFT_ONLY,
visible in audience review and have no automatic publication route or quota claim.

No deployment: the three source PRs remain open, and the independent production
hosting, SELECT-only grants and owner-authentication integration are not verified.
No live X or paid Grok requests are used in tests.
