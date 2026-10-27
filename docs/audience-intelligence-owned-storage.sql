-- NOT EXECUTED. Run only in an independent audience-owned Postgres database.
CREATE TABLE IF NOT EXISTS audience_jobs (
  x_post_id text PRIMARY KEY CHECK (x_post_id ~ '^[0-9]{1,30}$'),
  receipt_id text NOT NULL,
  formation_id text NOT NULL,
  scan_sha256 char(64) NOT NULL CHECK (scan_sha256 ~ '^[0-9a-f]{64}$'),
  scan_url text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Single atomic statement, safe across process restarts and competing workers:
-- INSERT INTO audience_jobs(x_post_id,receipt_id,formation_id,scan_sha256,scan_url)
-- VALUES($1,$2,$3,$4,$5) ON CONFLICT (x_post_id) DO NOTHING RETURNING x_post_id;
-- A duplicate with different provenance must be flagged for review, not overwritten.
