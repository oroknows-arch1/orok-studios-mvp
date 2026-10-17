# Native V3 X authentication

PR #18 uses only `orok-studios-api` and its existing PostgreSQL database. There is no Redis/Key Value connection, legacy token import, legacy refresh-owner flag or call to `emradar-x-executor`. Publishing remains OFF unless separately authorised.

## One-time owner setup (after this PR is reviewed)

1. In the existing X Developer app, retain its client ID and client secret. Add this exact callback URL to its OAuth 2.0 authentication settings; retain the old callback while the legacy service is preserved:

   `https://orok-studios-api.onrender.com/api/review/x/callback`

   This is the configured V3 review origin plus `/api/review/x/callback`; if `EMRADAR_V3_REVIEW_ORIGIN` is changed, register that origin's exact callback instead. The flow requests `tweet.read users.read tweet.write media.write offline.access` and verifies the intended account before saving authorisation. No new X account or developer app is required.
2. In **Render → orok-studios-api → Environment**, configure privately:

   | Variable | Value |
   | --- | --- |
   | `X_CLIENT_ID` | Existing app's OAuth 2.0 client ID |
   | `X_CLIENT_SECRET` | Existing client secret, if the app is a confidential client |
   | `X_ACCOUNT_USERNAME` | Intended existing X handle, without `@` |
   | `X_ACCOUNT_ID` | Optional additional numeric account pin if already known |
   | `EMRADAR_V3_X_TOKEN_KEY` | Stable base64 encoding of 32 cryptographically random bytes |
   | `EMRADAR_V3_X_PUBLISH_ENABLED` | `false` |

   The existing `EMRADAR_V3_REVIEW_ORIGIN` and V3 PostgreSQL configuration are reused. Keep the encryption key separate from database backups and never commit, log or paste it into chat. On the owner's Mac, `openssl rand -base64 32 | pbcopy` generates a fresh key directly into the clipboard for private entry into Render; do not run it again after tokens have been saved. Preserve this key across deployments and restarts. Replacing it makes saved authorisation unreadable and requires a new owner connection.

   No `KEY_VALUE_URL`, `REDIS_URL`, `EMRADAR_V3_X_REFRESH_OWNER` or `EMRADAR_V3_X_READ_ENABLED` is used by V3. Do not transfer legacy access/refresh tokens. Do not change or remove any unrelated service environment settings. Use **Save only** to batch configuration with the later approved deployment.
3. Merge/deploy only when separately authorised. This task updates PR #18 only. The additive initializer creates `v3_x_authorization` and `v3_x_oauth_states` in the existing V3 database; it does not rewrite campaigns, approvals, directory records or receipts. Missing X configuration does not block email release or owner review.
4. Open the existing private owner review in the same browser that will complete X consent. Click **Connect X**, authorise the intended account on X, and return to the review. The emailed review session is the V3 authentication; no additional V3 login, Render login or invitation is needed to connect.
5. Click **Check X connection**. Confirm the displayed handle is correct. Native token renewal happens under the V3 database lock when needed. Neither connection nor renewal uploads media, posts to X, sends email or changes approvals. Do not use legacy publishing during the verification/cutover; this task does not stop or delete legacy services. Reauthorisation of the same X app/account may affect its previous grant, so do not assume legacy authorisation remains usable.
6. Before authorising publishing, reconcile current campaign `v3-2602ddf68a3ced8aeafb769fc928423f`. The optional Render-shell command below reads the existing approved asset and checks the account, scopes, exact graphic hash and bounded publication history without refresh, upload or posting:

   ```sh
   node scripts/verify-v3-x.cjs v3-2602ddf68a3ced8aeafb769fc928423f
   ```

   If the access token expired, use **Check X connection** in the authenticated owner review to renew it, then run the read-only inspection. Unknown or incomplete history, an existing exact post, wrong account or an uncertain prior receipt blocks release. Do not remove claims or invent a receipt to continue. No editorial email is resent.
7. Only after V3 is independently verified, separately authorise `EMRADAR_V3_X_PUBLISH_ENABLED=true`. The owner must still explicitly use **Publish approved X post** and confirm the exact saved text and graphic. Connecting X or approving content never publishes it. Legacy deletion is deferred until V3 verification; preserve historical records and the scanner.

## Security and persistence

- AES-256-GCM encrypts access/refresh tokens and pending PKCE verifiers in PostgreSQL with fresh 96-bit IVs. Authenticated associated data binds ciphertext to this V3 client and record purpose. Database records contain no plaintext token or PKCE verifier.
- OAuth uses random state stored only as a hash, S256 PKCE, ten-minute expiry, single-use atomic consumption, and the initiating campaign/owner-session binding. Only the latest connection attempt remains active. Denied consent, invalid scopes or wrong account cannot overwrite saved authorisation.
- Connect, callback completion and connection checks reuse owner-session authentication, same-origin checks and CSRF. The GET callback renders a nonce-protected same-origin POST bridge so Strict cookies work after X redirects. It neither consumes state nor exchanges credentials; code/state are not interpolated into HTML. The bridge clears the query string before posting it. Server responses never return tokens or PKCE secrets.
- Renewal and connection completion share the existing V3 PostgreSQL advisory-lock mechanism. An encrypted ambiguity marker is committed before refresh; crashes or uncertain responses cannot trigger repeated refresh attempts. Reconnect through the owner flow if an ambiguity cannot be resolved. No legacy process shares these tokens.
- Existing approved assets, graphic verification, media processing, campaign claims, durable reservations, receipts and feedback remain intact. Publication history checks retain the existing five-page bound and fail closed on unknown results. No automatic distribution is added.

## Targeted verification

```sh
node --test test/emradar-v3-x-auth.test.cjs test/emradar-v3-x.test.cjs test/emradar-v3-wiring.test.cjs test/emradar-v3-boundary.test.cjs test/emradar-v3-distribution-ready.test.cjs test/emradar-v3-review-renewal.test.mjs
```

Authentication tests exercise the actual encryption/OAuth implementation and production SQL contracts with a disposable SQL fixture and simulated X responses. They are not live X authentication or a live PostgreSQL connection. Live credentials, registered callback, account consent and production persistence remain owner/deployment verification steps. No credentials were retrieved, no real grant exchanged and no external email or post sent while preparing this PR.

X protocol reference: https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code .
