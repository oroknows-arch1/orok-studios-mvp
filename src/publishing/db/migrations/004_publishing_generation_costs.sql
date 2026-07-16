-- Publishing API Cost Ledger v0.1
-- Observational table for text-generation OpenAI usage/cost estimates.
-- One row per OpenAI generation request (not per candidate).
-- Does not affect draft generation, approval, or publication behaviour.
CREATE TABLE IF NOT EXISTS publishing_generation_costs (
  id                   TEXT PRIMARY KEY,
  generation_id        TEXT NOT NULL,
  publishing_item_id   TEXT,
  stream               TEXT,
  category             TEXT,
  provider             TEXT NOT NULL DEFAULT 'openai',
  model                TEXT,
  input_tokens         INTEGER,
  output_tokens        INTEGER,
  total_tokens         INTEGER,
  estimated_cost_usd   NUMERIC(18, 8),
  status               TEXT NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT publishing_generation_costs_status_check
    CHECK (status IN ('generated', 'accepted', 'discarded', 'failed')),
  CONSTRAINT publishing_generation_costs_tokens_nonneg
    CHECK (
      (input_tokens IS NULL OR input_tokens >= 0) AND
      (output_tokens IS NULL OR output_tokens >= 0) AND
      (total_tokens IS NULL OR total_tokens >= 0)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS publishing_generation_costs_generation_id_uidx
  ON publishing_generation_costs (generation_id);

CREATE INDEX IF NOT EXISTS publishing_generation_costs_publishing_item_id_idx
  ON publishing_generation_costs (publishing_item_id);

CREATE INDEX IF NOT EXISTS publishing_generation_costs_created_at_idx
  ON publishing_generation_costs (created_at DESC);

CREATE INDEX IF NOT EXISTS publishing_generation_costs_stream_idx
  ON publishing_generation_costs (stream);

CREATE INDEX IF NOT EXISTS publishing_generation_costs_status_idx
  ON publishing_generation_costs (status);
