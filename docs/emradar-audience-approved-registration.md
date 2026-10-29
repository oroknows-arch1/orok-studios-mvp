# Trusted thread registration boundary

The registration wrapper first validates ordered, explicitly approved segments and their canonical hashes. It then calls an independently sourced trusted approval verifier and only on success registers the thread in PostgreSQL.

It is **not** mounted to production. The trusted reader implementation must still be wired to V3's real owner authentication and persisted review state; the verifier is dependency-injected and a caller-controlled implementation would not be secure. Database registration is not an authorization substitute. The executor independently rechecks approval before posting.

No X request, Render deployment, owner notification, or live publishing is triggered.
