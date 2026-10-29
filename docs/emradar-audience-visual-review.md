# Full visual owner review — isolated component

`prepareVisualReview` renders all planned posts in sequence, preserving exact text, showing attached graphics when an HTTPS preview URL and image SHA-256 are supplied, and exposing canonical per-post asset hashes. It flags missing image previews/hashes and marks the preview ineligible for authenticated approval.

**Not a live V3 UI:** the component returns static escaped HTML for future insertion in the existing owner-review interface. No approval button or publication action is mounted. Its `ready_for_authenticated_approval` flag is a presentation precondition, **not authorization**.

Before live integration, verify image preview bytes against SHA-256 (this component only checks hash shape), enforce safe trusted image URLs and exact approved media mapping, verify full scan record coverage, make link preview fidelity explicit, add authenticated owner controls, and connect the V3 approval record. X itself may render links/media differently than the preview. No live X request or V3 modification.
