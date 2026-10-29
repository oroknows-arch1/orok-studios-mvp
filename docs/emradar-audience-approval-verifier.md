# Independent audience-thread approval verification

`createAudienceApprovalVerifier` reads an approval and review from **injected trusted readers**; it never trusts the caller's owner label alone. It requires matching campaign, review identity, source scan hash, independently verified actor, and exact ordered segment hashes including text and media.

The readers must be implemented against V3's authoritative persisted owner approval and review data. They are NOT connected here. `actor_verified` is a claim supplied by the trusted reader, not a substitute for validating the real V3 authorization mechanism. The verifier currently does not independently validate publication provenance or media upload provenance. Do not connect to production until those checks and the review schema are reconciled.

The existing prototype decision-package hash excludes media; production must use one canonical hash format across review, store and verifier. This module deliberately fails closed on mismatches.
