# Isolated end-to-end simulation

The test `test/emradar-audience-end-to-end.test.cjs` simulates a published scan containing two discoveries, builds the complete review and decision package, and uses an in-memory reservation mock plus injected X transport to verify three sequential X payloads and parent receipt IDs.

It also simulates a transport failure and verifies that the next post is blocked.

**Scope limitation:** This is a simulation, not a production end-to-end test. The owner decision is a caller-provided assertion rather than an authenticated V3 review, the storage is a mock rather than PostgreSQL, X responses are mocked, no graphic upload occurs, and Grok is not invoked. Do not deploy until these boundaries are addressed.
