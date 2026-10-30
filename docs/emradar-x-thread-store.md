# Isolated durable X thread store

The `ThreadStore` class adds a **separate** PostgreSQL table `emradar_x_thread_posts`; it does not touch V3's existing `v3_send_reservations`.

It atomically registers a sequence of approved segments, reserves exactly one pending post at a time under row locks, requires all preceding posts to have accepted receipts, and records either an accepted X ID or an ambiguous outcome. Ambiguous outcomes block subsequent reservations. Duplicate registration fails closed.

**Not yet production-ready:** `register` accepts caller-provided approval flags and therefore requires an independently authenticated, durable V3 owner approval verifier before it can be invoked. Persisting the approval snapshot, scan hash, graphic hashes and review identity is still required. Network failures must be recorded as ambiguous by the future orchestrator. The DB migration and full Postgres integration tests have not been executed; the class has not been mounted. The current V3 single-post publisher is unchanged.
