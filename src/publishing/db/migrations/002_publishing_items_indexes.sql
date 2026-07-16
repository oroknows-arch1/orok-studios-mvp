-- A published Coffee Break Build series number must be globally unique. This
-- partial unique index is the authoritative guard against duplicate published
-- numbers, even under concurrent publishes. It intentionally does NOT apply to
-- drafts, so two drafts may temporarily reserve the same next number.
CREATE UNIQUE INDEX IF NOT EXISTS uq_publishing_published_cbb_series
  ON publishing_items (series_number)
  WHERE status = 'published'
    AND stream = 'coffee-break-build'
    AND series_number IS NOT NULL;

-- Query helper indexes.
CREATE INDEX IF NOT EXISTS idx_publishing_status ON publishing_items (status);
CREATE INDEX IF NOT EXISTS idx_publishing_stream ON publishing_items (stream);
CREATE INDEX IF NOT EXISTS idx_publishing_planned_date ON publishing_items (planned_date);
CREATE INDEX IF NOT EXISTS idx_publishing_published_at ON publishing_items (published_at);

-- Coffee Break Build series-number lookups (used by next-number calculation).
CREATE INDEX IF NOT EXISTS idx_publishing_cbb_series
  ON publishing_items (series_number)
  WHERE stream = 'coffee-break-build';
