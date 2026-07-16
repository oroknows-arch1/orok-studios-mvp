"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { assertDatabaseUrl, resolveSsl } = require("../src/publishing/db/pool");
const { loadMigrations, computePending } = require("../src/publishing/db/migrate");
const { rowToModel, modelToValues, COLUMNS } = require("../src/publishing/db/mapper");
const { createItem } = require("../src/publishing/model");
const { createRepositoryFromEnv } = require("../src/publishing/repository");
const { parseArgs } = require("../src/publishing/db/import-file");

/* 3. Required DATABASE_URL validation */
test("assertDatabaseUrl rejects missing/empty values", () => {
  assert.throws(() => assertDatabaseUrl(undefined), /requires a DATABASE_URL/);
  assert.throws(() => assertDatabaseUrl(""), /requires a DATABASE_URL/);
  assert.throws(() => assertDatabaseUrl("   "), /requires a DATABASE_URL/);
});

test("assertDatabaseUrl rejects non-postgres schemes and garbage", () => {
  assert.throws(() => assertDatabaseUrl("mysql://x/y"), /postgres/);
  assert.throws(() => assertDatabaseUrl("not a url"), /valid connection URL/);
});

test("assertDatabaseUrl accepts postgres URLs", () => {
  assert.equal(
    assertDatabaseUrl("postgres://u:p@host:5432/db"),
    "postgres://u:p@host:5432/db"
  );
  assert.equal(
    assertDatabaseUrl("postgresql://u@host/db"),
    "postgresql://u@host/db"
  );
});

test("resolveSsl: localhost off, remote on, sslmode/env overrides", () => {
  assert.equal(resolveSsl("postgres://u@127.0.0.1:5432/db"), false);
  assert.equal(resolveSsl("postgres://u@localhost/db"), false);
  assert.deepEqual(resolveSsl("postgres://u@db.example.com/db"), {
    rejectUnauthorized: false,
  });
  assert.deepEqual(resolveSsl("postgres://u@localhost/db?sslmode=require"), {
    rejectUnauthorized: false,
  });
});

/* 4. No silent storage fallback */
test("postgres mode without DATABASE_URL throws (no silent fallback)", () => {
  const saved = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  try {
    assert.throws(
      () => createRepositoryFromEnv({ mode: "postgres" }),
      /DATABASE_URL/
    );
  } finally {
    if (saved !== undefined) process.env.DATABASE_URL = saved;
  }
});

test("postgres mode with URL returns a postgres adapter without connecting", () => {
  const repo = createRepositoryFromEnv({
    mode: "postgres",
    databaseUrl: "postgres://u@127.0.0.1:5432/db",
  });
  assert.equal(repo.getStorageType(), "postgres");
  return repo.close();
});

test("unknown storage mode throws instead of falling back", () => {
  assert.throws(() => createRepositoryFromEnv({ mode: "sqlite" }), /Unknown PUBLISHING_STORAGE/);
});

test("memory and file adapters remain selectable", () => {
  assert.equal(createRepositoryFromEnv({ mode: "memory" }).getStorageType(), "memory");
  assert.equal(
    createRepositoryFromEnv({ mode: "file", filePath: "/tmp/x.json" }).getStorageType(),
    "file"
  );
});

/* 5. Migration ordering  &  6 groundwork for idempotency */
test("migrations load in deterministic filename order", () => {
  const migrations = loadMigrations();
  assert.ok(migrations.length >= 2);
  const names = migrations.map((m) => m.name);
  const sorted = [...names].sort((a, b) => a.localeCompare(b, "en"));
  assert.deepEqual(names, sorted);
  assert.equal(names[0], "001_create_publishing_items.sql");
});

test("computePending returns only unapplied migrations in order", () => {
  const all = ["001_a.sql", "002_b.sql", "003_c.sql"];
  assert.deepEqual(computePending(all, []), all);
  assert.deepEqual(computePending(all, ["001_a.sql"]), ["002_b.sql", "003_c.sql"]);
  assert.deepEqual(computePending(all, all), []);
  // already-applied set with unknown extras does not affect ordering
  assert.deepEqual(computePending(all, ["002_b.sql"]), ["001_a.sql", "003_c.sql"]);
});

/* 1 & 2. row<->model mapping */
test("modelToValues yields one value per column", () => {
  const item = createItem({
    stream: "coffee-break-build",
    plannedDate: "2026-07-16",
    topic: "mapping",
    text: "body",
    status: "draft",
    seriesNumber: 2,
    imageRequired: true,
    imageBrief: "brief",
  });
  const values = modelToValues(item);
  assert.equal(values.length, COLUMNS.length);
  // history column serialized as JSON string
  assert.equal(typeof values[COLUMNS.indexOf("history")], "string");
  assert.equal(values[COLUMNS.indexOf("image_required")], true);
  assert.equal(values[COLUMNS.indexOf("series_number")], 2);
});

test("rowToModel maps snake_case row to camelCase model", () => {
  const row = {
    id: "abc",
    stream: "orok-morning",
    series_number: null,
    planned_date: "2026-07-16",
    generated_at: new Date("2026-07-16T00:00:00.000Z"),
    updated_at: new Date("2026-07-16T01:00:00.000Z"),
    status: "review",
    category: null,
    topic: "hello",
    dominant_pattern: null,
    version: 3,
    text: "the text",
    image_required: true,
    image_brief: "an image",
    published_at: null,
    post_url: null,
    rejection_reason: null,
    notes: null,
    similarity_opening: "opening line",
    similarity_central_lesson: null,
    similarity_example: null,
    similarity_image_concept: "an image",
    history: '[{"version":1,"status":"draft","text":"old","at":"x"}]',
  };
  const model = rowToModel(row);
  assert.equal(model.id, "abc");
  assert.equal(model.seriesNumber, undefined);
  assert.equal(model.plannedDate, "2026-07-16");
  assert.equal(model.generatedAt, "2026-07-16T00:00:00.000Z");
  assert.equal(model.version, 3);
  assert.equal(model.imageRequired, true);
  assert.equal(model.similarityKeys.opening, "opening line");
  assert.equal(model.similarityKeys.centralLesson, undefined);
  assert.equal(model.history.length, 1);
  assert.equal(model.history[0].text, "old");
});

test("row/model round-trip preserves core fields", () => {
  const item = createItem({
    id: "rt-1",
    stream: "sunday-long-game",
    plannedDate: "2026-07-19",
    topic: "round trip",
    text: "content",
    status: "draft",
    imageRequired: false,
  });
  const values = modelToValues(item);
  const row = {};
  COLUMNS.forEach((c, i) => (row[c] = values[i]));
  row.history = values[COLUMNS.indexOf("history")]; // JSON string
  const back = rowToModel(row);
  assert.equal(back.id, item.id);
  assert.equal(back.stream, item.stream);
  assert.equal(back.topic, item.topic);
  assert.equal(back.plannedDate, "2026-07-19");
  assert.equal(back.version, 1);
});

/* import CLI arg parsing */
test("import-file parseArgs handles --file and --dry-run", () => {
  const a = parseArgs(["--file", "./data/publishing.json", "--dry-run"]);
  assert.equal(a.file, "./data/publishing.json");
  assert.equal(a.dryRun, true);
  const b = parseArgs([]);
  assert.equal(b.dryRun, false);
  assert.ok(b.file.endsWith("publishing.json"));
});
