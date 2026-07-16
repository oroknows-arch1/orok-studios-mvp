"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { createPool } = require("../src/publishing/db/pool");
const { runMigrations } = require("../src/publishing/db/migrate");
const { importFile } = require("../src/publishing/db/import-file");
const { createItem } = require("../src/publishing/model");

const DB = process.env.TEST_DATABASE_URL;
const skip = DB ? undefined : "TEST_DATABASE_URL not set (PostgreSQL integration skipped)";

let pool;
const tmpFiles = [];

test.before(async () => {
  if (!DB) return;
  pool = createPool(DB, { connectionTimeoutMillis: 5000 });
  await runMigrations(pool);
});

test.after(async () => {
  if (pool) await pool.end().catch(() => {});
  for (const f of tmpFiles) fs.rmSync(f, { force: true });
});

function writeTempFile(records) {
  const file = path.join(os.tmpdir(), `import-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
  fs.writeFileSync(file, JSON.stringify(records, null, 2), "utf8");
  tmpFiles.push(file);
  return file;
}

function validRecord(overrides = {}) {
  return createItem(
    Object.assign(
      {
        stream: "orok-morning",
        plannedDate: "2026-07-16",
        generatedAt: "2026-07-16T00:00:00.000Z",
        topic: "imported",
        text: "imported text",
        status: "draft",
        imageRequired: false,
      },
      overrides
    )
  );
}

async function count() {
  const res = await pool.query("SELECT COUNT(*)::int AS c FROM publishing_items");
  return res.rows[0].c;
}

/* 9. file import dry run */
test("dry-run import commits nothing", { skip }, async () => {
  await pool.query("TRUNCATE publishing_items");
  const file = writeTempFile([validRecord({ id: "imp-dry-1" }), validRecord({ id: "imp-dry-2" })]);
  const result = await importFile({ pool, filePath: file, dryRun: true });
  assert.equal(result.imported, 2);
  assert.equal(result.failed, 0);
  assert.equal(result.dryRun, true);
  assert.equal(await count(), 0, "dry run must not persist anything");
});

/* 10. file import preserves IDs and dates */
test("import preserves ids, versions, dates, status and text", { skip }, async () => {
  await pool.query("TRUNCATE publishing_items");
  const rec = validRecord({
    id: "imp-preserve-1",
    version: 4,
    status: "published",
    publishedAt: "2026-07-15T09:30:00.000Z",
    plannedDate: "2026-07-15",
    generatedAt: "2026-07-10T00:00:00.000Z",
    text: "final text",
    seriesNumber: 7,
    stream: "coffee-break-build",
    rejectionReason: undefined,
  });
  const file = writeTempFile([rec]);
  const result = await importFile({ pool, filePath: file });
  assert.equal(result.imported, 1);

  const res = await pool.query("SELECT * FROM publishing_items WHERE id = $1", ["imp-preserve-1"]);
  const { rowToModel } = require("../src/publishing/db/mapper");
  const back = rowToModel(res.rows[0]);
  assert.equal(back.id, "imp-preserve-1");
  assert.equal(back.version, 4);
  assert.equal(back.status, "published");
  assert.equal(back.seriesNumber, 7);
  assert.equal(back.plannedDate, "2026-07-15");
  assert.equal(back.generatedAt, "2026-07-10T00:00:00.000Z");
  assert.equal(back.publishedAt, "2026-07-15T09:30:00.000Z");
  assert.equal(back.text, "final text");
});

/* 11. file import skips existing IDs */
test("re-importing the same file skips existing ids", { skip }, async () => {
  await pool.query("TRUNCATE publishing_items");
  const file = writeTempFile([validRecord({ id: "imp-skip-1" }), validRecord({ id: "imp-skip-2" })]);
  const first = await importFile({ pool, filePath: file });
  assert.equal(first.imported, 2);
  const second = await importFile({ pool, filePath: file });
  assert.equal(second.imported, 0);
  assert.equal(second.skipped, 2);
  assert.equal(await count(), 2);
});

/* 12. transaction rollback on invalid import */
test("an invalid record rolls back the entire import", { skip }, async () => {
  await pool.query("TRUNCATE publishing_items");
  const good = validRecord({ id: "imp-good-1" });
  const bad = validRecord({ id: "imp-bad-1" });
  bad.stream = "not-a-real-stream"; // invalid
  const file = writeTempFile([good, bad]);
  const result = await importFile({ pool, filePath: file });
  assert.ok(result.failed >= 1);
  assert.equal(await count(), 0, "no partial import when a record is invalid");
});

/* source file is never modified */
test("import does not modify the source file", { skip }, async () => {
  await pool.query("TRUNCATE publishing_items");
  const file = writeTempFile([validRecord({ id: "imp-src-1" })]);
  const before = fs.readFileSync(file, "utf8");
  await importFile({ pool, filePath: file });
  const after = fs.readFileSync(file, "utf8");
  assert.equal(before, after);
});
