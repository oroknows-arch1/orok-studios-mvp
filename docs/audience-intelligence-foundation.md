# EMRADAR Audience Intelligence — bounded foundation

Status: DESIGN ONLY / NOT ENABLED
Owner approval: planning and isolated foundation only. No publishing, API polling, deployment, or campaign mutation.

## Purpose
Find relevant public conversations for already-published, evidence-verified EMRADAR discoveries; prepare human-reviewed original X posts, quote posts and replies; learn which audiences respond. Engagement must never influence research findings or evidence states.

## Worker graph
1. **Published-evidence gate**: accept only a published scan with stable URL, original-source references, evidence IDs, evidence state, limitations and source digest. Reject missing provenance.
2. **Conversation scout**: collect public original posts from a bounded owner-configured watchlist plus a separately labelled recent discovery set. Record URL, author, time, metrics, and collection time. Never infer view counts or engagement.
3. **Relevance matcher**: score relationship to the specific verified finding and its target professions. Reject superficial keyword matches and unsupported connections.
4. **Pattern miner**: summarize structural techniques from examples (opening, framing, visual format), never reproduce distinctive language.
5. **Draft worker**: generate an original post, optional quote/reply, source URL, relevant natural-language terms and claim-to-evidence mapping; explicitly preserve uncertainty.
6. **Safety and editorial gate**: reject unsupported claims, copied wording, misleading framing, unverifiable metrics and unavailable links. No automated editorial veto of the existing V3 campaign; this is a separate audience draft gate.
7. **Owner review gate**: save, edit, reject or approve drafts. Approval of a draft is NOT approval to publish unless a separate explicit distribution action is taken.
8. **Distribution receipt**: only an authorised existing X route may publish; durable idempotency key, receipt and retry controls required.
9. **Outcome collector**: record attributable impressions, relevant replies, qualified contacts and site traffic when measurable; label missing attribution UNKNOWN.
10. **Feedback router**: improve topic presentation, account selection and timing, never underlying research claims.

## Persistence contracts (proposed; no schema migration)
- discovery_ref: published URL, formation ID, source IDs, digest, uncertainty
- conversation_ref: X post URL/ID, author, observed timestamp, metrics and observation timestamp
- candidate: discovery_ref, conversation_ref, relevance rationale, intended audience, status
- draft: candidate ID, copy, claim-to-evidence map, limitations, revision, owner decision
- distribution: authorisation, dedupe key, provider receipt, state
- outcome: observation time, impression count, engagement, qualified interest, attribution confidence

## Hard gates
- No X credentials or scraping bypasses.
- No new paid provider without explicit cost approval.
- No publishing or outbound replies without separate owner approval.
- No invented engagement metrics, claims, citations, audiences or conversions.
- No impact on scanner, current V3 campaigns, editorial review or mail delivery.
- No audience optimisation that changes evidence or causal conclusions.
- No automatic retries of ambiguous publication attempts.

## Acceptance checks for implementation
1. A published, sourced formation can produce an evidence-mapped draft.
2. An unpublished/unsourced formation cannot produce a ready draft.
3. Irrelevant viral content is excluded even with high impressions.
4. Duplicate conversations and publication attempts are idempotent.
5. Rejected and edited drafts preserve version history.
6. Approval and publishing remain distinct permissions.
7. Missing X analytics or site attribution remains UNKNOWN, not zero or success.
8. Existing harness:verify and harness:v3 remain green.
9. No changes to live campaign, scanner, recipients, X posts or receipts.
10. Production remains untouched until explicit approval and verification.

## Initial scope
Implement the offline candidate-and-draft contract first, using saved fixtures and no external API calls. Integrate with existing V3 review and distribution only after targeted regressions and owner inspection.
