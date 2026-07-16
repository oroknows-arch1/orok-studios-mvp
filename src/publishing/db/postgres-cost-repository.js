"use strict";

const { CostLedgerRepository } = require("../costs/repository-interface");
const { buildSummary } = require("../costs/aggregates");
const {
  COST_COLUMNS,
  rowToCostRecord,
  costRecordToValues,
} = require("./cost-mapper");

const TABLE = "publishing_generation_costs";

/**
 * PostgreSQL adapter for the Publishing API Cost Ledger.
 */
class PostgresCostLedgerRepository extends CostLedgerRepository {
  /** @param {import("pg").Pool} pool */
  constructor(pool) {
    super();
    this.pool = pool;
  }

  getStorageType() {
    return "postgres";
  }

  async init() {}

  async close() {
    // Pool lifecycle is owned by the publishing repository / app wiring.
  }

  async create(record) {
    const values = costRecordToValues(record);
    const placeholders = COST_COLUMNS.map((_, i) => `$${i + 1}`).join(", ");
    const sql = `INSERT INTO ${TABLE} (${COST_COLUMNS.join(", ")})
                 VALUES (${placeholders})
                 ON CONFLICT (generation_id) DO UPDATE SET
                   publishing_item_id = EXCLUDED.publishing_item_id,
                   stream = EXCLUDED.stream,
                   category = EXCLUDED.category,
                   provider = EXCLUDED.provider,
                   model = EXCLUDED.model,
                   input_tokens = EXCLUDED.input_tokens,
                   output_tokens = EXCLUDED.output_tokens,
                   total_tokens = EXCLUDED.total_tokens,
                   estimated_cost_usd = EXCLUDED.estimated_cost_usd,
                   status = EXCLUDED.status,
                   updated_at = EXCLUDED.updated_at
                 RETURNING *`;
    const res = await this.pool.query(sql, values);
    return rowToCostRecord(res.rows[0]);
  }

  async getByGenerationId(generationId) {
    const res = await this.pool.query(
      `SELECT * FROM ${TABLE} WHERE generation_id = $1`,
      [generationId]
    );
    return res.rows.length ? rowToCostRecord(res.rows[0]) : null;
  }

  async attachPublishingItem(generationId, publishingItemId) {
    const res = await this.pool.query(
      `UPDATE ${TABLE}
       SET publishing_item_id = $2, updated_at = now()
       WHERE generation_id = $1
       RETURNING *`,
      [generationId, publishingItemId]
    );
    return res.rows.length ? rowToCostRecord(res.rows[0]) : null;
  }

  async markAccepted(generationId) {
    return this._setStatus(generationId, "accepted");
  }

  async markDiscarded(generationId) {
    return this._setStatus(generationId, "discarded");
  }

  async markFailed(generationId) {
    return this._setStatus(generationId, "failed");
  }

  async listRecent(opts = {}) {
    const limit = Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : 25;
    const res = await this.pool.query(
      `SELECT * FROM ${TABLE} ORDER BY created_at DESC LIMIT $1`,
      [limit]
    );
    return res.rows.map(rowToCostRecord);
  }

  async aggregateSummary(range = {}) {
    // Fetch filtered rows and reuse the shared pure aggregator so memory/file/
    // postgres summaries stay identical. Volume is expected to be modest for v0.1.
    const values = [];
    const where = [];
    let n = 1;
    if (range.from) {
      where.push(`created_at >= $${n++}::timestamptz`);
      values.push(expandFrom(range.from));
    }
    if (range.to) {
      where.push(`created_at <= $${n++}::timestamptz`);
      values.push(expandTo(range.to));
    }
    const sql =
      `SELECT * FROM ${TABLE}` +
      (where.length ? ` WHERE ${where.join(" AND ")}` : "") +
      ` ORDER BY created_at DESC`;
    const res = await this.pool.query(sql, values);
    return buildSummary(res.rows.map(rowToCostRecord));
  }

  async _setStatus(generationId, status) {
    const res = await this.pool.query(
      `UPDATE ${TABLE}
       SET status = $2, updated_at = now()
       WHERE generation_id = $1
       RETURNING *`,
      [generationId, status]
    );
    return res.rows.length ? rowToCostRecord(res.rows[0]) : null;
  }
}

function expandFrom(value) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return `${value}T00:00:00.000Z`;
  return value;
}

function expandTo(value) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return `${value}T23:59:59.999Z`;
  return value;
}

module.exports = { PostgresCostLedgerRepository };
