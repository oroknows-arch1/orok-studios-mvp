#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { collectItemErrors } = require("../validation");
const { modelToValues, COLUMNS } = require("./mapper");

const TABLE = "publishing_items";

/**
 * Import a JSON file store into PostgreSQL inside a single transaction.
 *
 * Guarantees:
 *   - every record is validated; invalid records are counted as failures
 *   - if ANY record is invalid, the whole import is rolled back (no partial import)
 *   - records whose id already exists are skipped safely
 *   - IDs, versions, dates, statuses, text and metadata are preserved as-is
 *   - dry-run always rolls back
 *   - the source file is never modified
 *
 * @param {{pool: import("pg").Pool, filePath: string, dryRun?: boolean, logger?: Function}} opts
 * @returns {Promise<{total:number, imported:number, skipped:number, failed:number, dryRun:boolean, errors:Array}>}
 */
async function importFile(opts) {
  const { pool, filePath } = opts;
  const dryRun = !!opts.dryRun;
  const log = opts.logger || (() => {});

  const raw = fs.readFileSync(filePath, "utf8");
  let records;
  try {
    records = JSON.parse(raw);
  } catch (_e) {
    throw new Error("Source file is not valid JSON.");
  }
  if (!Array.isArray(records)) {
    throw new Error("Source file must contain a JSON array of publishing items.");
  }

  const result = {
    total: records.length,
    imported: 0,
    skipped: 0,
    failed: 0,
    dryRun,
    errors: [],
  };

  const placeholders = COLUMNS.map((_, i) => `$${i + 1}`).join(", ");
  const insertSql = `INSERT INTO ${TABLE} (${COLUMNS.join(", ")}) VALUES (${placeholders})`;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    for (const record of records) {
      const errors = collectItemErrors(record);
      if (errors.length) {
        result.failed += 1;
        result.errors.push({ id: record && record.id, errors });
        log(`FAILED ${record && record.id}: ${errors.join("; ")}`);
        continue;
      }

      const exists = await client.query(
        `SELECT 1 FROM ${TABLE} WHERE id = $1`,
        [record.id]
      );
      if (exists.rowCount > 0) {
        result.skipped += 1;
        log(`SKIP ${record.id} (already exists)`);
        continue;
      }

      // Preserve everything; only ensure the shape has the nested containers
      // that the mapper expects, without altering existing values.
      const normalized = Object.assign({}, record, {
        similarityKeys: record.similarityKeys || {},
        history: Array.isArray(record.history) ? record.history : [],
      });
      await client.query(insertSql, modelToValues(normalized));
      result.imported += 1;
      log(`IMPORT ${record.id}`);
    }

    if (result.failed > 0) {
      await client.query("ROLLBACK");
      log("Rolled back: invalid records prevented a complete import.");
    } else if (dryRun) {
      await client.query("ROLLBACK");
      log("Dry run: rolled back (no changes committed).");
    } else {
      await client.query("COMMIT");
      log("Committed.");
    }
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  return result;
}

/** Parse CLI flags: --file <path> and --dry-run. */
function parseArgs(argv) {
  const out = { file: path.join(process.cwd(), "data", "publishing.json"), dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--file") out.file = argv[++i];
    else if (argv[i] === "--dry-run") out.dryRun = true;
  }
  return out;
}

async function main() {
  const { createPool } = require("./pool");
  const args = parseArgs(process.argv.slice(2));
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required to import into PostgreSQL.");
    process.exit(1);
  }
  if (!fs.existsSync(args.file)) {
    console.error(`Source file not found: ${args.file}`);
    process.exit(1);
  }

  let pool;
  try {
    pool = createPool(url);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
    return;
  }

  try {
    const result = await importFile({
      pool,
      filePath: args.file,
      dryRun: args.dryRun,
      logger: (m) => console.log(m),
    });
    console.log(
      `\n${args.dryRun ? "[DRY RUN] " : ""}total=${result.total} imported=${result.imported} skipped=${result.skipped} failed=${result.failed}`
    );
    if (result.failed > 0) {
      console.error("Import incomplete: invalid records were found. Nothing was committed.");
      process.exitCode = 1;
    }
  } catch (err) {
    console.error("Import error: " + err.message);
    process.exitCode = 1;
  } finally {
    await pool.end().catch(() => {});
  }
}

if (require.main === module) {
  main();
}

module.exports = { importFile, parseArgs };
