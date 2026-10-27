-- NOT EXECUTED. DBA-reviewed migration for a separate Audience Intelligence database.
-- Do not apply to V3 production until role credentials and privileges are approved.
-- Run as a V3 database administrator; use a separate audience database for jobs.
BEGIN;
CREATE ROLE emradar_audience_reader LOGIN NOINHERIT PASSWORD NULL;
REVOKE ALL ON SCHEMA public FROM emradar_audience_reader;
GRANT USAGE ON SCHEMA public TO emradar_audience_reader;
CREATE OR REPLACE VIEW public.audience_confirmed_x_receipts
WITH (security_barrier = true) AS
SELECT campaign_id,
       payload->'scan' AS scan,
       payload#>'{decisions,x}' AS owner_x_decision,
       payload#>'{deliveries,x}' AS x_delivery
FROM public.v3_campaign_state
WHERE payload#>>'{deliveries,x,status}' = 'ACCEPTED'
  AND payload#>>'{decisions,x,authority}' = 'OWNER'
  AND payload#>>'{decisions,x,decision}' = 'APPROVE'
  AND payload#>>'{decisions,x,destination_id}' = 'x';
REVOKE ALL ON public.audience_confirmed_x_receipts FROM PUBLIC;
GRANT SELECT ON public.audience_confirmed_x_receipts TO emradar_audience_reader;
COMMIT;
-- CRITICAL: Ordinary views can run with view-owner privileges. Verify reader
-- cannot access underlying tables or other public views. Verify search_path.
-- Verify has_table_privilege(reader, 'public.v3_campaign_state', 'INSERT') = false,
-- and UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER = false.
-- No production connection string should be shared with the audience worker.
