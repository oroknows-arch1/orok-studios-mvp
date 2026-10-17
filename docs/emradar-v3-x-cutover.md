# V3 X cutover

Prepared code only. X reading, refreshing and posting are disabled by default.
No startup publication, legacy HTTP dependency, new token store or campaign-specific credentials.

## One-time owner actions, after this patch passes review

1. Preserve `emradar-x-auth` (`red-davaei2a3nsc73fgs8s0`), its data and all source configuration. Do not revoke the X app or copy token JSON. Do not delete the Key Value resource.
2. Stop/suspend **emradar-x-executor** and confirm Render shows it suspended before assigning V3 refresh ownership. Do not resume it while V3 owns refresh. Removing only its client secret is insufficient: public-client refresh can still run, and an old process may retain loaded credentials. Stop is reversible; service deletion is unnecessary.
3. `orok-studios-api` is in Oregon; the existing Key Value is in Singapore. In the target service's **Connect → Outbound** view, obtain its documented outbound IP ranges. On **emradar-x-auth → Networking / access controls**, allow only those ranges for authenticated external TLS access. Preserve other existing rules; never allow `0.0.0.0/0`.
4. Privately copy the source service's `X_CLIENT_ID` and, if present, `X_CLIENT_SECRET` to the target's **Environment**. Set `KEY_VALUE_URL` to the existing resource's authenticated **external `rediss://` URL**, not the Singapore internal URL. Keep the source values unchanged. Do not copy `MARKETING_ENGINE_TOKEN`, old `PUBLIC_BASE_URL`, LinkedIn credentials or token JSON.
5. Set `X_ACCOUNT_USERNAME` to the intended existing X account handle (without `@`). If its numeric ID is already known, `X_ACCOUNT_ID` can additionally pin it; no ID lookup is required from the owner. Set `EMRADAR_V3_X_READ_ENABLED=true`. Keep `EMRADAR_V3_X_PUBLISH_ENABLED=false`. Only after step 2 is confirmed, set `EMRADAR_V3_X_REFRESH_OWNER=v3-after-legacy-shutdown`. This is an explicit owner cutover attestation, not automatic proof of legacy shutdown. Use **Save only** to batch these with the tested patch's single deployment.
6. After deployment, run the provided script in the target Render Shell:

   ```sh
   node scripts/verify-v3-x.cjs v3-2602ddf68a3ced8aeafb769fc928423f
   ```

   This reads saved assets and authentication, verifies the account and checks publication history. It never posts, uploads media, sends email or refreshes credentials. Output is limited to redacted status, account ID, graphic hash and reconciliation evidence.

   If it reports `V3_X_REFRESH_DISABLED` because the existing access token expired, confirm the old service is still stopped, then use:

   ```sh
   node scripts/verify-v3-x.cjs v3-2602ddf68a3ced8aeafb769fc928423f --allow-refresh-after-cutover
   ```

   This permits the normal OAuth refresh only under the cutover flag and shared V3 database lock. It is a future owner action; no refresh was executed while preparing this patch. Interrupted/ambiguous refresh is durably guarded in the existing token JSON and cannot automatically repeat.
7. An identity mismatch, existing exact post, incomplete history, missing scopes or uncertain receipt blocks release. Investigate/reconcile; do not delete claims, clear ambiguity markers, change approvals or retry a possibly accepted post. A successfully identified existing post needs independent receipt reconciliation before marking distribution complete; this patch never invents a receipt.
8. Only after identity, scopes and history checks pass, enable `EMRADAR_V3_X_PUBLISH_ENABLED=true` through a separately authorised configuration activation. Publish only through the existing private owner review's **Publish approved X post** control and explicit confirmation. Approval alone never posts. The email already sent is not released again.

## Verification and boundaries

- Targeted tests: `node --test test/emradar-v3-x.test.cjs test/emradar-v3-distribution-ready.test.cjs test/emradar-v3-wiring.test.cjs test/emradar-v3-boundary.test.cjs`.
- Existing keys: canonical `marketing:x:authorized`; read-compatible EMRADAR fallbacks `marketing:x:authorized:emradar`, `emradar:x:authorized`. No automatic borrowing of Atlasoquence authentication.
- Existing paid Key Value persistence and `noeviction` remain unchanged. No environment token snapshot is created.
- V3 refresh uses the existing PostgreSQL service for an advisory lock and the existing Key Value record for interruption protection. The lock coordinates V3 instances only; legacy shutdown is mandatory.
- Source logic: `oroknows-arch1/emradar-marketing/server.js` and `runtime/x-authorization.js`. Image upload follows initialize, append, finalize, bounded processing-status reads, then a single post create with the exact text and media ID.
- X status endpoint: https://docs.x.com/x-api/media/get-media-upload-status .
- Publication-history research is bounded to five pages of 100 posts from one day before the scan date. API errors, missing/truncated text or remaining pages fail closed. No automatic retry or inference that unknown means unpublished.
- Campaign state, assets, approvals, scanner, editorial reference and existing email transport remain intact. Existing campaign delivery claims and `v3_send_reservations` prevent duplicate attempts; post ID plus graphic/account/reconciliation evidence are saved in the delivery receipt.
- Runtime credentials, X scopes/permissions, account identity, live connectivity and current publication status remain unverified until cutover. Passing simulated transport tests is not live authentication verification.

## Rollback

Disable V3 posting and remove its refresh-owner flag before considering resuming the legacy service. If a refresh is in progress or its outcome is ambiguous, do not resume either refresher until that outcome is resolved. Preserve the latest Key Value record and every reservation/receipt.
