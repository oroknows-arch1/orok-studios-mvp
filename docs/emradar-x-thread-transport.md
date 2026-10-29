# Isolated X API transport

`createXThreadTransport` constructs POST `/2/tweets` requests with exact text, optional `reply.in_reply_to_tweet_id`, and optional **already-uploaded** X media IDs. It accepts a supplied OAuth2 user access token and injected fetch implementation; it does not fetch tokens or upload media. A confirmed numeric X post ID is required.

Important: a successful transport response is **not** independent approval. Only the trusted executor may call this adapter after durable owner approval and reservation. Any HTTP/network/parse failure is an ambiguous external outcome and must not be retried automatically.

Outstanding: platform entitlement and length validation, exact approved image attachment, real X OAuth token lifecycle, verified durable V3 review, Postgres integration, and end-to-end staging. No live request or deployment has been performed.
