# Full-scan X thread review decision boundary

The isolated `prepareAudienceReview` produces a preview from a verified published-scan document. `prepareDecisionPackage` derives immutable per-segment hashes, and `recordOwnerDecision` checks the review identity, source digest, segment order, segment hashes, and explicit decisions.

These are **pure data transformations, not authenticated owner approvals**. The `actor: 'OWNER'` field is an assertion by the caller and MUST NOT be trusted in production. A real integration must use the existing V3 authenticated review session and durable owner-decision verification before calling this module. The state `APPROVED_FOR_FUTURE_RELEASE` is not authority to publish.

Do not mount a new route, modify existing V3 decisions, or invoke the X publisher until authenticated review, durable records, full visual approval, and the per-post receipt database are implemented and verified. Existing production remains untouched.
