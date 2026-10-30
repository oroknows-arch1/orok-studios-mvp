# Isolated X thread executor

`createThreadExecutor` publishes **one segment per invocation**. It first calls an injected trusted verifier for independently persisted V3 owner approval, then reserves the post in a durable store, then invokes an injected X transport and records the confirmed X receipt. Transport errors or missing receipts become ambiguous and halt further publishing. It does not retry.

The verifier and publisher are **not implemented or connected** here. A boolean returned by an untrusted verifier is not authorization. A production verifier must compare campaign, source scan hash, review identity, every segment text/graphic hash and durable owner approval. The publisher must use authorized X credentials, the exact approved media and `reply.in_reply_to_tweet_id` for non-lead segments.

Remaining failure mode: if receipt persistence itself fails after X accepts the post, the reservation remains RESERVED and must be manually reconciled; never retry. This is intentional fail-closed behavior.

No production mount, credentials, or live X request.
