# Full-scan discovery coverage requirement

**A published X post is the trigger, not the research boundary.** The research input is the full, verified published scan's `records` array. Preserve every record ID, its original causal chain, evidence, state, uncertainty and source order; do not select only the X headline discovery.

The new `src/emradar-grok-discovery-coverage.cjs` adapter provides a deterministic coverage manifest and detects missing/unknown record IDs. Grok research should batch records to fit context limits, with a bounded request/cost budget and resumable checkpoints. Each record must be classified as investigated, linked to grounded X opportunities, or explicitly `NO_RELEVANT_DISCUSSION_FOUND` / `NOT_RESEARCHED` with a reason. Do not claim complete coverage when budget, search or provider limits prevent it.

For each record, map its direct topic, adjacent sectors, bottlenecks, connected companies, and cross-record causal relationships to distinct X conversations. Deduplicate conversations globally while retaining all linked record IDs. Rank engagement opportunities by evidentiary fit, not raw popularity. Public actions remain subject to owner approval.

This branch has no production integration or live API validation. The original Grok pilot module still accepts only the post and evidence; the next code step is to connect full-scan manifests to bounded Grok calls and coverage checks. The scanner and V3 publishing gates are unchanged.
