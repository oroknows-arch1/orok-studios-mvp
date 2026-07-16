"use strict";

const fs = require("fs");
const path = require("path");

const MIGRATIONS_DIR = path.join(__dirname, "migrations");
const MIGRATIONS_TABLE = "publishing_migrations";

/**
 * Load all migration files from a directory, ordered deterministically by
 * filename. Pure: no database access.
 * @param {string} [dir]
 * @returns {Array<{name: string, sql: string}>}
 */
function loadMigrations(dir = MIGRATIONS_DIR) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b, "en"))
    .map((name) => ({
      name,
      sql: fs.readFileSync(path.join(dir, name), "utf8"),
    }));
}

/**
 * Given all migration names (ordered) and the set of applied names, return the
 * ordered list of pending migration names. Pure: no database access.
 * @param {string[]} allNames ordered
 * @param {Iterable<string>} appliedNames
 * @returns {string[]}
 */
function computePending(allNames, appliedNames) {
  const applied = new Set(appliedNames);
  return allNames.filter((name) => !applied.has(name));
}

/** Ensure the migrations bookkeeping table exists. Idempotent. */
async function ensureMigrationsTable(client) {
  await client.query(
    `CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
       name TEXT PRIMARY KEY,
       applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
     )`
  );
}

/** @returns {Promise<string[]>} names of applied migrations, ordered. */
async function getApplied(client) {
  await ensureMigrationsTable(client);
  const res = await client.query(
    `SELECT name FROM ${MIGRATIONS_TABLE} ORDER BY name ASC`
  );
  return res.rows.map((r) => r.name);
}

/**
 * Run all pending migrations in order. Each migration executes inside its own
 * transaction and is recorded on success, so the process is safe to re-run and
 * a failure leaves the schema at the last successful migration.
 * @param {import("pg").Pool} pool
 * @param {{logger?: (msg: string) => void}} [opts]
 * @returns {Promise<{applied: string[], alreadyApplied: string[]}>}
 */
async function runMigrations(pool, opts = {}) {
  const log = opts.logger || (() => {});
  const all = loadMigrations();
  const client = await pool.connect();
  const appliedNow = [];
  let alreadyApplied = [];
  try {
    alreadyApplied = await getApplied(client);
    const pending = computePending(
      all.map((m) => m.name),
      alreadyApplied
    );
    if (pending.length === 0) {
      log("No pending migrations. Schema is current.");
    }
    for (const name of pending) {
      const migration = all.find((m) => m.name === name);
      log(`Applying migration: ${name}`);
      try {
        await client.query("BEGIN");
        await client.query(migration.sql);
        await client.query(
          `INSERT INTO ${MIGRATIONS_TABLE} (name) VALUES ($1)`,
          [name]
        );
        await client.query("COMMIT");
        appliedNow.push(name);
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(`Migration ${name} failed: ${err.message}`);
      }
    }
    return { applied: appliedNow, alreadyApplied };
  } finally {
    client.release();
  }
}

/**
 * Compute migration status without changing anything.
 * @param {import("pg").Pool} pool
 * @returns {Promise<{all: string[], applied: string[], pending: string[], current: boolean}>}
 */
async function migrationStatus(pool) {
  const all = loadMigrations().map((m) => m.name);
  const client = await pool.connect();
  try {
    const applied = await getApplied(client);
    const pending = computePending(all, applied);
    return { all, applied, pending, current: pending.length === 0 };
  } finally {
    client.release();
  }
}

module.exports = {
  MIGRATIONS_DIR,
  MIGRATIONS_TABLE,
  loadMigrations,
  computePending,
  ensureMigrationsTable,
  getApplied,
  runMigrations,
  migrationStatus,
};
