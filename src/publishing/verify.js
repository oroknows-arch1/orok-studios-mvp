#!/usr/bin/env node
"use strict";

const { PublishingService, SEED_CBB_001_ID } = require("./service");
const { createRepositoryFromEnv } = require("./repository");
const { collectItemErrors } = require("./validation");
const { COFFEE_BREAK_STREAM } = require("./numbering");

/**
 * Read-only verification of the publishing store. Performs NO writes (it does
 * not seed). Returns a structured result; the CLI turns failures into a
 * non-zero exit code. Output never contains credentials or connection details.
 *
 * @param {PublishingService} service
 * @returns {Promise<{ok: boolean, checks: Array<{name:string, ok:boolean, detail?:string}>}>}
 */
async function runVerification(service) {
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok: !!ok, detail: detail || "" });

  let health = { databaseReachable: false, migrationsCurrent: false };
  try {
    health = await service.health();
  } catch (_e) {
    // handled by the checks below
  }
  add("repository reachable", health.databaseReachable === true);
  add("migrations current", health.migrationsCurrent === true);

  let items = [];
  let listOk = true;
  try {
    items = await service.listItems();
  } catch (_e) {
    listOk = false;
  }
  add("records readable", listOk);

  const seed =
    items.find((i) => i.id === SEED_CBB_001_ID) ||
    (listOk ? await service.getItem(SEED_CBB_001_ID).catch(() => null) : null);
  add("Coffee Break Build #001 exists", !!seed);
  add("Coffee Break Build #001 is published", !!seed && seed.status === "published");
  add("Coffee Break Build #001 series number is 1", !!seed && seed.seriesNumber === 1);

  const publishedCbbNumbers = items
    .filter(
      (i) =>
        i.stream === COFFEE_BREAK_STREAM &&
        i.status === "published" &&
        Number.isInteger(i.seriesNumber)
    )
    .map((i) => i.seriesNumber);
  const duplicates = [
    ...new Set(publishedCbbNumbers.filter((n, idx) => publishedCbbNumbers.indexOf(n) !== idx)),
  ];
  add(
    "no duplicate published Coffee Break Build numbers",
    duplicates.length === 0,
    duplicates.length ? `duplicates: ${duplicates.join(", ")}` : ""
  );

  let invalid = 0;
  for (const it of items) {
    if (collectItemErrors(it).length > 0) invalid += 1;
  }
  add("all stored records satisfy model validation", invalid === 0, invalid ? `${invalid} invalid record(s)` : "");

  let dashboardOk = true;
  try {
    await service.dashboard();
  } catch (_e) {
    dashboardOk = false;
  }
  add("dashboard aggregation executes", dashboardOk);

  const ok = checks.every((c) => c.ok);
  return { ok, checks };
}

async function main() {
  // Build the same storage the app uses (env-driven) but do NOT seed.
  const repository = createRepositoryFromEnv();
  const service = new PublishingService(repository);
  try {
    // init() prepares the store for reading (no-op for postgres, opens the file
    // for the file adapter); it never seeds records.
    await repository.init();
    const { ok, checks } = await runVerification(service);
    for (const c of checks) {
      const mark = c.ok ? "PASS" : "FAIL";
      console.log(`[${mark}] ${c.name}${c.detail ? " — " + c.detail : ""}`);
    }
    console.log(ok ? "\nVerification passed." : "\nVerification FAILED.");
    process.exitCode = ok ? 0 : 1;
  } catch (err) {
    // Never print the connection string or a stack trace.
    console.error("Verification error: " + (err && err.message ? err.message : "unknown"));
    process.exitCode = 1;
  } finally {
    await repository.close().catch(() => {});
  }
}

if (require.main === module) {
  main();
}

module.exports = { runVerification };
