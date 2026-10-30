# V3 full-scan X thread: controlled release

The feature reuses V3's owner session, review page, decision/edit endpoints, campaign CAS, OAuth identity verification and exact-byte media upload. Existing editorial assets, recipient rules, email release, Purelymail notifications and scanner schedules remain in place. Campaigns with an existing legacy X decision or delivery retain their existing review.

New proposals are stored in `audience_x_review`. The source is the hash-verified published checkpoint, never a reconstructed marketing scan. Every discovery forms one ordered group; standard-length continuation posts retain that identity. `twitter-text` validates the final parts before review. Premium long-post eligibility is not assumed. The October 17 staging proposal contains 96 parts because it preserves the full causal chain, source evidence, uncertainty and break conditions. Publication volume still requires the owner's editorial judgment in the ordinary review.

The review displays every final post, source link, saved graphic and parent relationship. Explicit discovery exclusions remain visible. Text edits and choosing a verified saved V3 graphic create a new manifest and invalidate previous approval. Arbitrary caller-supplied graphics and new unverified source links cannot authorize publication. The browser waits for every selected image to load; server-side byte hashes and raster decoding are checked independently before approval.

`audience_x_approval` binds the manifest, source identity, review ID and authenticated V3 owner session to a persisted decision event. Automatic checks persist in `audience_x_checks`; the publication worker rechecks trusted approval, complete coverage and exact assets before every post. Caller actor/status flags are not authority.

`emradar_x_thread_posts` holds immutable asset hashes, transactional reservations, upload evidence, provider receipts and parent IDs. Confirmed prefixes resume in bounded batches. Reserved or ambiguous rows are never reset or blindly retried: independent account-history reconciliation must match exact text, parent and uploaded media evidence. Unknown outcomes remain halted. Confirmed progress and the final thread URL appear in V3 review.

After every post is confirmed, Grok receives each original discovery, including records explicitly excluded from X. Research uses bounded batches, input/output limits, hosted-search turn bounds, durable claims, actual billed usage, per-run reservations, rate-limit backoff and daily source/model caching. Accepted opportunities require discovery/evidence identity, citations and provider search-usage provenance. Suggestions and replies remain drafts; public engagement actions are disabled.

Hosted X Search has no documented per-request dollar ceiling. Local accounting cannot prevent an in-flight hosted-tool overrun. Automatic research therefore requires an independently configured provider spending limit, as well as local budget settings. A timeout retains its reservation and is not blindly retried. Missing usage or provenance fails closed.

Optional measurement reads only verified account-owned post metrics, at most two API requests per six-hour campaign window. Immutable observation records preserve actual counts; missing metrics are not invented. Referral attribution is explicitly unavailable until a web-analytics source is connected. Additional social platforms are inactive.

Activation settings (all new features remain opt-in):

- `EMRADAR_V3_X_THREAD_REVIEW_ENABLED=true`: prepare/render the full proposal in the existing review.
- `EMRADAR_V3_X_THREAD_PUBLISH_ENABLED=true` and existing `EMRADAR_V3_X_PUBLISH_ENABLED=true`: permit the bounded post-approval publisher and restart worker.
- `EMRADAR_GROK_AUDIENCE_ENABLED=true`, existing `XAI_API_KEY`, configured `EMRADAR_GROK_MODEL` (or `GROK_MODEL`), `EMRADAR_GROK_RUN_BUDGET_USD`, `EMRADAR_GROK_REQUEST_RESERVE_USD` and `EMRADAR_GROK_PROVIDER_SPEND_LIMIT_VERIFIED=true`: permit research after confirmed publication. The last setting records operator verification of a real provider-side limit; it does not create that limit.
- `EMRADAR_X_AUDIENCE_METRICS_ENABLED=true`: permit read-only engagement observation.

Rollback disables the new flags. Preserve all campaign review history, thread rows, upload checkpoints and receipts; never reset an ambiguous reservation. No live publication, editorial email, production campaign mutation or deployment is part of staging verification. Production deployment and an owner's exact-content publication authorization remain separate gates.
