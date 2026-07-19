"use strict";

const crypto = require("crypto");
const { PublishingRepository } = require("../repository-interface");
const { rowToModel, modelToValues, COLUMNS, sourcesToRows } = require("./mapper");
const { migrationStatus } = require("./migrate");
const { TransitionError } = require("../transitions");
const { STREAMS, STATUSES } = require("../constants");

const TABLE = "publishing_items";
const SOURCES_TABLE = "publishing_long_game_sources";
const SELECT_ALL = `SELECT * FROM ${TABLE}`;

/**
 * PostgreSQL-backed implementation of the publishing repository interface.
 * All PostgreSQL specifics (SQL, snake_case, row types) are contained here and
 * mapped back to the application model before leaving the adapter.
 */
class PostgresPublishingRepository extends PublishingRepository {
  /** @param {import("pg").Pool} pool */
  constructor(pool) {
    super();
    this.pool = pool;
  }

  getStorageType() {
    return "postgres";
  }

  /**
   * No schema work happens at startup — migrations are run explicitly via the
   * CLI. init() is intentionally a lazy no-op so a transient DB outage does not
   * crash the wider application at boot.
   */
  async init() {}

  async list(filter = {}) {
    const { where, values } = buildFilter(filter);
    const sql =
      SELECT_ALL +
      (where.length ? ` WHERE ${where.join(" AND ")}` : "") +
      ` ORDER BY planned_date DESC, updated_at DESC`;
    const res = await this.pool.query(sql, values);
    return res.rows.map(rowToModel);
  }

  async get(id) {
    const res = await this.pool.query(`${SELECT_ALL} WHERE id = $1`, [id]);
    return res.rows.length ? rowToModel(res.rows[0]) : null;
  }

  async create(item) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const values = modelToValues(item);
      const placeholders = COLUMNS.map((_, i) => `$${i + 1}`).join(", ");
      const sql = `INSERT INTO ${TABLE} (${COLUMNS.join(", ")}) VALUES (${placeholders}) RETURNING *`;
      const res = await client.query(sql, values);
      await syncSources(client, item);
      await client.query("COMMIT");
      return rowToModel(res.rows[0]);
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw mapPgError(err);
    } finally {
      client.release();
    }
  }

  async save(item) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const values = modelToValues(item);
      const updates = COLUMNS.filter((c) => c !== "id")
        .map((c, i) => `${c} = $${i + 2}`)
        .join(", ");
      const placeholders = COLUMNS.map((_, i) => `$${i + 1}`).join(", ");
      const sql =
        `INSERT INTO ${TABLE} (${COLUMNS.join(", ")}) VALUES (${placeholders}) ` +
        `ON CONFLICT (id) DO UPDATE SET ${updates} RETURNING *`;
      const res = await client.query(sql, values);
      await syncSources(client, item);
      await client.query("COMMIT");
      return rowToModel(res.rows[0]);
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw mapPgError(err);
    } finally {
      client.release();
    }
  }

  async delete(id) {
    // Child sources cascade via FK ON DELETE CASCADE.
    const res = await this.pool.query(`DELETE FROM ${TABLE} WHERE id = $1`, [id]);
    return res.rowCount > 0;
  }

  /**
   * Atomically read-modify-write a single row under a row lock (SELECT ... FOR
   * UPDATE) inside a transaction. The mutator receives the current model and
   * returns the next model (or null to abort). Throwing inside the mutator
   * (e.g. an illegal transition) rolls the transaction back. This guarantees:
   *   - status transitions never overwrite a concurrently-updated row
   *   - publishing is atomic (validate + confirm number + persist + commit)
   * @param {string} id
   * @param {(current: object) => (object|Promise<object>)} mutator
   */
  async atomicUpdate(id, mutator) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const res = await client.query(
        `${SELECT_ALL} WHERE id = $1 FOR UPDATE`,
        [id]
      );
      if (res.rows.length === 0) {
        await client.query("ROLLBACK");
        return null;
      }
      const current = rowToModel(res.rows[0]);
      const next = await mutator(current);
      if (!next) {
        await client.query("ROLLBACK");
        return null;
      }
      const values = modelToValues(next);
      const updates = COLUMNS.filter((c) => c !== "id")
        .map((c, i) => `${c} = $${i + 2}`)
        .join(", ");
      const sql = `UPDATE ${TABLE} SET ${updates} WHERE id = $1 RETURNING *`;
      const updated = await client.query(sql, values);
      await syncSources(client, next);
      await client.query("COMMIT");
      return rowToModel(updated.rows[0]);
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw mapPgError(err);
    } finally {
      client.release();
    }
  }

  /**
   * Storage readiness. Returns only safe, non-sensitive information.
   * @returns {Promise<{ok: boolean, storage: string, databaseReachable: boolean, migrationsCurrent: boolean}>}
   */
  async health() {
    const result = {
      ok: false,
      storage: "postgres",
      databaseReachable: false,
      migrationsCurrent: false,
    };
    try {
      await this.pool.query("SELECT 1");
      result.databaseReachable = true;
    } catch (_err) {
      return result;
    }
    try {
      const status = await migrationStatus(this.pool);
      result.migrationsCurrent = status.current;
    } catch (_err) {
      result.migrationsCurrent = false;
    }
    result.ok = result.databaseReachable && result.migrationsCurrent;
    return result;
  }

  async close() {
    await this.pool.end().catch(() => {});
  }
}

/**
 * Replace child source rows for an item so historical editions retain searchable
 * source metadata (topic, pattern via parent, publisher, year, url).
 * @param {import("pg").PoolClient} client
 * @param {object} item
 */
async function syncSources(client, item) {
  // Table may not exist until migration 004 is applied — fail clearly via SQL.
  await client.query(`DELETE FROM ${SOURCES_TABLE} WHERE item_id = $1`, [item.id]);
  const rows = sourcesToRows(item);
  for (const row of rows) {
    await client.query(
      `INSERT INTO ${SOURCES_TABLE}
        (id, item_id, title, url, publisher, publication_date, access_date, topic, category)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        row.id || crypto.randomUUID(),
        row.item_id,
        row.title,
        row.url,
        row.publisher,
        row.publication_date,
        row.access_date,
        row.topic,
        row.category,
      ]
    );
  }
}

/**
 * Build WHERE clauses for list filters, including Long Game search dimensions:
 * topic, pattern, publisher, year, source (title/url).
 */
function buildFilter(filter = {}) {
  const where = [];
  const values = [];
  let n = 1;

  if (filter.stream && STREAMS.includes(filter.stream)) {
    where.push(`stream = $${n++}`);
    values.push(filter.stream);
  }
    if (filter.status && STATUSES.includes(filter.status)) {
      where.push(`status = $${n++}`);
      values.push(filter.status);
    }
    if (filter.category && String(filter.category).trim()) {
      where.push(`category = $${n++}`);
      values.push(String(filter.category).trim());
    }
    if (filter.date) {
    where.push(`planned_date = $${n++}`);
    values.push(String(filter.date).slice(0, 10));
  }
  if (filter.topic && String(filter.topic).trim()) {
    const q = `%${String(filter.topic).trim()}%`;
    where.push(
      `(topic ILIKE $${n} OR text ILIKE $${n} OR COALESCE(category,'') ILIKE $${n} OR COALESCE(macro_signal,'') ILIKE $${n})`
    );
    values.push(q);
    n++;
  }
  if (filter.pattern && String(filter.pattern).trim()) {
    where.push(`COALESCE(dominant_pattern,'') ILIKE $${n++}`);
    values.push(`%${String(filter.pattern).trim()}%`);
  }
  if (filter.publisher && String(filter.publisher).trim()) {
    where.push(
      `EXISTS (
         SELECT 1 FROM ${SOURCES_TABLE} s
         WHERE s.item_id = ${TABLE}.id
           AND COALESCE(s.publisher,'') ILIKE $${n}
       )`
    );
    values.push(`%${String(filter.publisher).trim()}%`);
    n++;
  }
  if (filter.year && String(filter.year).trim()) {
    const year = Number(filter.year);
    if (Number.isInteger(year) && year >= 1900 && year <= 2100) {
      where.push(
        `(
           EXTRACT(YEAR FROM planned_date) = $${n}
           OR EXISTS (
             SELECT 1 FROM ${SOURCES_TABLE} s
             WHERE s.item_id = ${TABLE}.id
               AND EXTRACT(YEAR FROM s.access_date) = $${n}
           )
         )`
      );
      values.push(year);
      n++;
    }
  }
  if (filter.source && String(filter.source).trim()) {
    const q = `%${String(filter.source).trim()}%`;
    where.push(
      `EXISTS (
         SELECT 1 FROM ${SOURCES_TABLE} s
         WHERE s.item_id = ${TABLE}.id
           AND (s.title ILIKE $${n} OR s.url ILIKE $${n} OR COALESCE(s.publisher,'') ILIKE $${n})
       )`
    );
    values.push(q);
    n++;
  }

  return { where, values };
}

/**
 * Translate a raw PostgreSQL error into a safe application error. A unique
 * violation on the published Coffee Break Build series index becomes a 409
 * conflict with a credential-free message.
 */
function mapPgError(err) {
  if (err && err.code === "23505") {
    const conflict = new TransitionError(
      "A published Coffee Break Build number conflict was detected; the number is already taken."
    );
    return conflict;
  }
  return err;
}

module.exports = { PostgresPublishingRepository, TABLE, SOURCES_TABLE };
