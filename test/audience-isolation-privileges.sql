-- ISOLATED TEST ONLY. Do not apply to production without separate approval.
BEGIN;
CREATE ROLE emradar_audience_reader NOLOGIN NOINHERIT;
CREATE SCHEMA audience_read;
REVOKE ALL ON SCHEMA audience_read FROM PUBLIC;
GRANT USAGE ON SCHEMA audience_read TO emradar_audience_reader;
CREATE TABLE public.v3_campaign_state(campaign_id text PRIMARY KEY,payload jsonb NOT NULL);
INSERT INTO public.v3_campaign_state VALUES ('fixture', '{
 "scan":{"artifact_sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},
 "decisions":{"x":{"authority":"OWNER","decision":"APPROVE","destination_id":"x"}},
 "deliveries":{"x":{"status":"ACCEPTED","receipt":{"accepted":true,"provider_id":"123"}}}
}'::jsonb);
CREATE VIEW audience_read.confirmed_x_receipts WITH (security_barrier=true) AS
 SELECT campaign_id, payload->'scan' AS scan,
 payload#>'{decisions,x}' AS owner_x_decision,
 payload#>'{deliveries,x}' AS x_delivery
 FROM public.v3_campaign_state
 WHERE payload#>>'{deliveries,x,status}'='ACCEPTED'
 AND payload#>>'{decisions,x,authority}'='OWNER'
 AND payload#>>'{decisions,x,decision}'='APPROVE'
 AND payload#>>'{decisions,x,destination_id}'='x';
REVOKE ALL ON audience_read.confirmed_x_receipts FROM PUBLIC;
GRANT SELECT ON audience_read.confirmed_x_receipts TO emradar_audience_reader;
COMMIT;
DO $$
BEGIN
 IF NOT has_table_privilege('emradar_audience_reader','audience_read.confirmed_x_receipts','SELECT')
 OR has_table_privilege('emradar_audience_reader','public.v3_campaign_state','SELECT')
 OR has_table_privilege('emradar_audience_reader','public.v3_campaign_state','INSERT')
 OR has_table_privilege('emradar_audience_reader','public.v3_campaign_state','UPDATE')
 OR has_table_privilege('emradar_audience_reader','public.v3_campaign_state','DELETE')
 OR has_schema_privilege('emradar_audience_reader','public','CREATE')
 OR has_schema_privilege('emradar_audience_reader','audience_read','CREATE')
 THEN RAISE EXCEPTION 'reader privilege isolation FAILED'; END IF;
END $$;
SET ROLE emradar_audience_reader;
SELECT count(*) FROM audience_read.confirmed_x_receipts;
DO $$
BEGIN
 BEGIN
  INSERT INTO public.v3_campaign_state VALUES('bad','{}');
  RAISE EXCEPTION 'unexpected INSERT privilege';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 BEGIN
  UPDATE public.v3_campaign_state SET payload='{}';
  RAISE EXCEPTION 'unexpected UPDATE privilege';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 BEGIN
  DELETE FROM public.v3_campaign_state;
  RAISE EXCEPTION 'unexpected DELETE privilege';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 BEGIN
  CREATE TABLE audience_read.illegal_write(id integer);
  RAISE EXCEPTION 'unexpected DDL privilege';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $$;
RESET ROLE;
