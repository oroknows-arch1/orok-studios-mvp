# EMRADAR Grok audience pilot (isolated branch)

This is a **non-deployed, read-only pilot module**. It is NOT connected to V3 publication, owner review, production credentials, or scheduled jobs.

Existing X publisher: `src/emradar-v3-x.cjs`, returning `receipt_id` and `post_url`. Future orchestration should enqueue research **only after** the durable X success receipt has been persisted, with a unique key on `receipt_id`; failures must not affect X posting or editorial review.

Usage (from a controlled internal worker, never a public endpoint):

```js
const {createGrokAudiencePilot} = require('./src/emradar-grok-audience-pilot.cjs');
const pilot = createGrokAudiencePilot({
  apiKey: process.env.XAI_API_KEY,
  model: process.env.EMRADAR_GROK_MODEL,
  enabled: process.env.EMRADAR_GROK_AUDIENCE_ENABLED === 'true'
});
const report = await pilot.research({
  post_id: confirmedReceipt.receipt_id,
  body: approvedAsset.body,
  evidence: verifiedEvidenceUrls
});
// Save report as a proposal for human review; NEVER auto-send.
```

Provider API endpoint, model support, X Search availability, usage charges and credentials need a controlled live test before enabling. The request uses xAI Responses API and x_search tool; provider schema/version may change. No secrets are stored in this repository.

Production integration requirements: opt-in, idempotent durable queue, cost and request caps, validation of returned URLs, retention limits, audit trail, explicit owner approval for replies/quotes/follows, and a separate nonblocking failure path. Do not alter existing X publish gates.
