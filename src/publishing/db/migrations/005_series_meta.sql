-- Amendment: Masters of Yesterday Cultural Series metadata
-- Forward-only. Does not alter migrations 001–004.
-- series_meta JSONB holds cultural rotation + Thursday Lingo fields.

ALTER TABLE publishing_items
  ADD COLUMN IF NOT EXISTS series_meta JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_publishing_series_meta_category
  ON publishing_items ((series_meta->>'category'));

CREATE INDEX IF NOT EXISTS idx_publishing_series_meta_country
  ON publishing_items ((series_meta->>'countryStream'));

CREATE INDEX IF NOT EXISTS idx_publishing_series_meta_subject
  ON publishing_items ((series_meta->>'culturalSubject'));

CREATE INDEX IF NOT EXISTS idx_publishing_series_meta_episode
  ON publishing_items ((series_meta->'thursdayLingo'->>'episodeId'));
