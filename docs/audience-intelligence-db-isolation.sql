-- STAGED ONLY; requires DBA approval. This script changes production permissions.
-- The reader must connect using separate credentials and cannot write to V3.
-- Dedicated schema avoids exposing a view in public.
BEGIN;
CREATE ROLE emradar_audience_reader LOGIN NOINHERIT PASSWORD NULL;
CREATE SCHEMA audience_read;
REVOKE ALL ON SCHEMA audience_read FROM PUBLIC;
GRANT USAGE ON SCHEMA audience_read TO emradar_audience_reader;
CREATE VIEW audience_read.confirmed_x_receipts WITH (security_barrier=true) AS
SELECT campaign_id,
       payload->'scan' AS scan,
       payload#>'{decisions,x}' AS owner_x_decision,
       payload#>'{assets,x,fingerprint}' AS x_asset_fingerprint,
       payload#>'{deliveries,x}' AS x_delivery
FROM public.v3_campaign_state
WHERE payload#>>'{deliveries,x,status}' = 'ACCEPTED'
  AND payload#>>'{decisions,x,authority}' = 'OWNER'
  AND payload#>>'{decisions,x,decision}' = 'APPROVE'
  AND payload#>>'{decisions,x,destination_id}' = 'x'
  AND payload#>>'{decisions,x,campaign_id}' = campaign_id;
REVOKE ALL ON audience_read.confirmed_x_receipts FROM PUBLIC;
GRANT SELECT ON audience_read.confirmed_x_receipts TO emradar_audience_reader;
COMMIT;
-- DO NOT use V3's privileged connection string for the audience worker.
-- Run privilege tests under the actual audience login, including CREATE, SELECT
-- on underlying tables, INSERT, UPDATE, DELETE, TRUNCATE and role membership.
-- The V3 scan artifact must be independently fetched and hashed before job creation.
