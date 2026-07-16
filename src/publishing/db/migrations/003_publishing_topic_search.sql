-- Topic search acceleration (best-effort). Uses the pg_trgm extension to make
-- case-insensitive substring matches on topic/category fast. If the deploying
-- role lacks permission to create the extension, this migration will fail and
-- report a non-zero exit code; topic search still works without it (falling
-- back to a sequential ILIKE scan), so operators may skip this migration.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_publishing_topic_trgm
  ON publishing_items USING gin (topic gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_publishing_category_trgm
  ON publishing_items USING gin (category gin_trgm_ops);
