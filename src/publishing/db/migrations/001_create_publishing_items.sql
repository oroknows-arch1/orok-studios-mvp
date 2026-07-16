-- Publishing items table. Mirrors the PublishingItem application contract.
-- Timestamps use TIMESTAMPTZ to preserve time-zone meaning (stored as UTC).
-- planned_date is a calendar DATE (no time component).
CREATE TABLE IF NOT EXISTS publishing_items (
  id                        TEXT PRIMARY KEY,
  stream                    TEXT NOT NULL,
  series_number             INTEGER,
  planned_date              DATE NOT NULL,
  generated_at              TIMESTAMPTZ NOT NULL,
  updated_at                TIMESTAMPTZ NOT NULL,
  status                    TEXT NOT NULL,
  category                  TEXT,
  topic                     TEXT NOT NULL,
  dominant_pattern          TEXT,
  version                   INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  text                      TEXT NOT NULL DEFAULT '',
  image_required            BOOLEAN NOT NULL DEFAULT FALSE,
  image_brief               TEXT,
  published_at              TIMESTAMPTZ,
  post_url                  TEXT,
  rejection_reason          TEXT,
  notes                     TEXT,
  similarity_opening        TEXT,
  similarity_central_lesson TEXT,
  similarity_example        TEXT,
  similarity_image_concept  TEXT,
  history                   JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- series_number, when present, must be positive
  CONSTRAINT publishing_series_number_positive
    CHECK (series_number IS NULL OR series_number >= 1)
);
