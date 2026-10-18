# Repository execution contract

Every development task in this repository must begin by reading this file and
`docs/development-objective.json`. Treat both as required inputs, not optional
documentation. Run `npm run harness:verify` before changing runtime code and
again before committing.

## Permanent rules

1. Preserve the existing working EMRADAR scanner.
2. Reuse the existing repository, runtime, database, workers, and deployment infrastructure.
3. Inspect repository and persistent production evidence before making changes.
4. Use the smallest implementation necessary to satisfy the active objective.
5. Recover automatically from ordinary failures only within explicit safety, idempotency, and cost limits.
6. Persist progress in `docs/development-objective.json` so interrupted work resumes from verified state.
7. Never treat local tests, a commit, a queued deploy, or HTTP success as a completed production outcome.
8. Never declare the objective complete until every acceptance condition in the objective checkpoint is verified.
9. Never send editorial email, publish X content, approve a proposal, change credentials, or otherwise distribute externally without separate explicit owner approval.
10. Preserve existing drafts, X content, graphics, campaign history, decisions, deliveries, receipts, and immutable identities.
11. Do not start another campaign, rebuild working components, reset recovery checkpoints, or retry ambiguous delivery.
12. Stop only for genuine security or permission requirements, owner decisions, defined spending limits, or failures that cannot be recovered safely.

## Execution method

- Chat and read-only inspection are the default. Use execution only when needed.
- Resume from the verified checkpoint; do not rediscover or re-prove known-good work without evidence it changed.
- Prefer deterministic tools over model reasoning where sufficient.
- Debug in this order: rank likely causes, perform the cheapest decisive check, make the smallest fix, reproduce the failing case, then run bounded regression tests.
- Preserve working architecture. Do not redesign, refactor, clean up, or expand scope unless explicitly requested.
- Near completion, freeze scope and finish the current end-to-end path before hardening or adding features.
- Optimise for minimum owner time, tool usage, and API spend while preserving correctness, evidence, and safety.

## EMRADAR V3 boundary

The active campaign is `v3-df5b240c718018880410c03a4c392d64`.
`PUBLICATION_REVIEW` is a hard distribution stop. Discovery and proposal
preparation may continue through the existing bounded recovery path, but email
delivery and X publication require separate explicit owner approval.


## Final EMRADAR Marketing sign-off control

- Exhaust Chat tools and existing verified state before considering Work. Never initiate an automatic Work handoff. Work is the owner's explicit choice only; any necessary Work prompt must be bounded, code-only and usage-optimal.
- The sole active objective is `emradar-v3-final-marketing-signoff` in `docs/development-objective.json`. Previous objective evidence must remain preserved.
- Finish V3 discovery coverage, automatic scan preparation, private review invitation to sean@emradar.net, owner approvals, authorised distribution, receipts, recovery and learning.
- Aim for 5-10 credible outlets per evidence-supported category, maximum 30 destinations total; never fabricate publications, contacts or causal relationships to meet a quota.
- Improve attributable publication evidence retrieval without weakening verified editorial-recipient restrictions.
- No scanner changes, new campaign, architecture migration, Atlasoquence work or external distribution without owner approval.
