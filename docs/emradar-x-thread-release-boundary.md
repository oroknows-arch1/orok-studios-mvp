# V3 full-scan X thread: safe release boundary

The existing V3 X path publishes **one** approved X asset with an image, through `src/emradar-v3-x.cjs`. The durable send reservation in `src/emradar-v3-boundary.cjs` is keyed by campaign/destination and **does not support multiple X posts**. Do not loop over the current publisher: that would bypass individual approvals and conflict with the unique reservation.

This branch introduces a **pure** receipt state machine for a future separate thread transport. It does not call X, touch the owner review, or modify V3 production.

Required implementation before production:
1. Generate a lead summary plus every published scan discovery, with evidence and uncertainty preserved. Ensure platform character/long-post eligibility, source links and image requirements for each approved segment.
2. Owner review must display **all** exact segment texts and graphics, and persist immutable approvals for each segment and the entire ordered thread.
3. Add a new database table with a unique (campaign_id, sequence) key and immutable asset hash. Reserve each segment transactionally before any X request. Store X post ID and parent ID for every accepted segment.
4. Publish segment N only when N-1 has an accepted durable receipt. Use `reply.in_reply_to_tweet_id` in X create-post payload. Never auto-retry unknown outcomes; halt and reconcile manually.
5. On partial success, report the published prefix and the remaining unpublished segments in owner review; never claim complete publication.
6. The Grok research worker consumes the full verified scan and all confirmed post receipts after the thread is complete (or explicit owner-approved partial handoff), and remains nonblocking.
7. Feature flag and staged verification are mandatory. Existing single-post V3 publishing remains unchanged until a separate approved cutover.

Test status: tests are committed, but no remote CI run or production verification has been performed.
