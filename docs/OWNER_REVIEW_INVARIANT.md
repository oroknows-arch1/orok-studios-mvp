# EMRADAR permanent code invariant — protected owner review

EMRADAR discovery, publication, V3 campaign preparation and Purelymail owner-review delivery MUST operate unchanged when every downstream component is slow, unavailable, disabled, or deleted.

Downstream means X publishing, Grok, audience research, polling, metrics, analytics and any future post-review consumer.

Release requirements:
1. No upstream path awaits downstream work, directly or indirectly. Downstream execution starts only after the protected review path is independently complete.
2. No downstream process can write V3 campaign, review, approval, source/provenance or notification state. Use independent credentials with SELECT-only upstream access and audience-owned storage.
3. No shared queue, lock, connection pool exhaustion, scheduler, startup dependency, or error propagation can interrupt owner-review delivery.
4. Disabling or deleting all downstream code and services requires no repair to discovery or owner review.
5. Failure-injection tests must cover downstream timeouts, failures, unavailable databases, Grok/X outages, storage errors and removal, while verifying review delivery proceeds.
6. Any violating PR is blocked from production release. Passing unrelated tests does not waive this invariant.

PR #26 remains a parked draft, not a prerequisite for PR #27. PR #27 must not be merged or activated with in-process awaited audience work or audience writes into V3 campaign state.

This policy is fail-closed for downstream releases, never for owner review.
