-- Amendment 001: Sunday Long Game Intelligence Engine
-- Extends the publishing ledger with macro signal, family lesson, and
-- source metadata. Sources are also normalised into a child table so
-- historical editions remain searchable by topic, pattern, publisher,
-- year, and source URL/title.

ALTER TABLE publishing_items
  ADD COLUMN IF NOT EXISTS macro_signal TEXT;

ALTER TABLE publishing_items
  ADD COLUMN IF NOT EXISTS family_lesson TEXT;

-- Denormalised JSON copy of sources on the item (2–5 entries for Long Game).
-- Keeps memory/file adapters and single-row reads simple; the child table
-- below is the searchable authority for source metadata queries.
ALTER TABLE publishing_items
  ADD COLUMN IF NOT EXISTS sources JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE TABLE IF NOT EXISTS publishing_long_game_sources (
  id                TEXT PRIMARY KEY,
  item_id           TEXT NOT NULL REFERENCES publishing_items(id) ON DELETE CASCADE,
  title             TEXT NOT NULL,
  url               TEXT NOT NULL,
  publisher         TEXT,
  publication_date  DATE,
  access_date       DATE NOT NULL,
  topic             TEXT,
  category          TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lg_sources_item
  ON publishing_long_game_sources (item_id);

CREATE INDEX IF NOT EXISTS idx_lg_sources_publisher
  ON publishing_long_game_sources (publisher);

CREATE INDEX IF NOT EXISTS idx_lg_sources_topic
  ON publishing_long_game_sources (topic);

CREATE INDEX IF NOT EXISTS idx_lg_sources_access_year
  ON publishing_long_game_sources ((EXTRACT(YEAR FROM access_date)));

CREATE INDEX IF NOT EXISTS idx_lg_sources_url
  ON publishing_long_game_sources (url);

CREATE INDEX IF NOT EXISTS idx_publishing_macro_signal
  ON publishing_items (macro_signal);

CREATE INDEX IF NOT EXISTS idx_publishing_dominant_pattern
  ON publishing_items (dominant_pattern);
