# V3 → Audience Intelligence: downstream-only integration contract

Status: DESIGN CONTRACT ONLY — NOT WIRED OR DEPLOYED

## Invariant
V3 scan intake, editorial preparation, owner review, distribution, receipts and recovery must not depend on Audience Intelligence availability, success, latency or state. No Audience Intelligence process can hold a V3 lock, change a V3 campaign, veto a publication, delay a receipt or alter V3 scheduling.

## Activation
1. Existing V3 owner approval and authorised X distribution complete under unchanged rules.
2. A durable, provider-confirmed successful X publication receipt exists. A queued, reserved, approved, drafted, failed or ambiguous delivery is not sufficient.
3. A separate read-only consumer obtains the completed receipt and associated published scan reference. No callback runs in the V3 critical path.
4. The consumer creates an independent audience job keyed by provider X post ID and formation/source identity. Duplicate observations do not create duplicate jobs.
5. On missing receipt, inaccessible sources, invalid provenance, transient error or unavailable X access: fail closed in the audience subsystem only. V3 continues unchanged.

## Data contract (conceptual)
- Input: receipt ID, provider X post ID and URL, successful delivery state, published scan URL, formation ID, evidence/source IDs, source digest, observed time.
- Output: audience-owned candidate, conversation, draft, recommendation, outcome and audit records only.
- V3 tables, review records, recipient lists, drafts, owner decisions, delivery reservations and receipts are immutable to this subsystem.
- Audience metrics may improve audience routing and presentation, but never research evidence, formation states or editorial decisions.

## Operational isolation
- Separate process/worker, credentials, queue, storage namespace and resource limits.
- Read-only V3 access scoped to successful X receipts and published research.
- No shared synchronous dependency, transaction, database advisory lock or retry queue.
- Bounded polling with backoff and deduplication; no direct calls from V3's distribution path.
- Audience outages, rate limits, API bills, model failures and backlog must have zero effect on V3.
- Outbound X replies/follows/community actions remain separately authorised and platform-compliant.
- Never infer successful delivery from approval, draft readiness or HTTP acceptance alone.

## Integration acceptance tests (not yet executed)
- V3 review and distribution pass unchanged when audience worker is stopped.
- Audience API timeouts, queue failures, malformed receipts and storage errors do not change V3 state or latency.
- No job before successful X publication receipt.
- One job per unique confirmed X post despite duplicate polling.
- No V3 write privileges available to audience worker.
- No cross-campaign or cross-formation evidence mixing.
- Production activation requires harness:verify, harness:v3, targeted tests and owner approval.

## Next implementation
Read-only receipt adapter against actual V3 persisted schema after inspection; avoid changing V3 source or database. Keep this PR draft until integration and regression evidence exists.
