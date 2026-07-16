#!/usr/bin/env node
"use strict";

/**
 * Migration CLI. Usage:
 *   node src/publishing/db/cli.js migrate   # apply pending migrations
 *   node src/publishing/db/cli.js status    # show applied/pending migrations
 *
 * Requires DATABASE_URL. Never prints the connection string or credentials.
 * Exits non-zero on failure.
 */

const { createPool } = require("./pool");
const { runMigrations, migrationStatus } = require("./migrate");

async function main() {
  const command = process.argv[2];
  const url = process.env.DATABASE_URL;

  if (!url) {
    console.error(
      "DATABASE_URL is required for database migrations. Set it and try again."
    );
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
    if (command === "migrate") {
      const { applied, alreadyApplied } = await runMigrations(pool, {
        logger: (msg) => console.log(msg),
      });
      console.log(
        `Done. ${applied.length} applied, ${alreadyApplied.length} already present.`
      );
      if (applied.length) console.log("Applied now: " + applied.join(", "));
    } else if (command === "status") {
      const status = await migrationStatus(pool);
      console.log("Migrations:");
      for (const name of status.all) {
        const mark = status.applied.includes(name) ? "[x]" : "[ ]";
        console.log(`  ${mark} ${name}`);
      }
      console.log(
        `Current: ${status.current ? "yes" : "no"} (${status.pending.length} pending)`
      );
    } else {
      console.error("Unknown command. Use 'migrate' or 'status'.");
      process.exitCode = 1;
    }
  } catch (err) {
    console.error("Migration error: " + err.message);
    process.exitCode = 1;
  } finally {
    await pool.end().catch(() => {});
  }
}

main();
