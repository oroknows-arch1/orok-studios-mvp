"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { createPool } = require("../src/publishing/db/pool");
const { runMigrations } = require("../src/publishing/db/migrate");
const { PublishingService, SEED_CBB_001_ID } = require("../src/publishing/service");
const { PostgresPublishingRepository } = require("../src/publishing/db/postgres-repository");

const DB = process.env.TEST_DATABASE_URL;
const skip = DB ? undefined : "TEST_DATABASE_URL not set (PostgreSQL integration skipped)";

let pool;

test.before(async () => {
  if (!DB) return;
  pool = createPool(DB, { connectionTimeoutMillis: 5000 });
  await runMigrations(pool);
});

test.after(async () => {
  if (pool) await pool.end().catch(() => {});
});

async function freshPgService() {
  await pool.query("TRUNCATE publishing_items");
  const svc = new PublishingService(new PostgresPublishingRepository(pool));
  await svc.init();
  return svc;
}

/* Repository contract + 20. full workflow via PostgreSQL */
test("full publishing workflow via PostgreSQL", { skip }, async () => {
  const svc = await freshPgService();
  const { item } = await svc.createDraft({
    stream: "orok-morning",
    plannedDate: "2026-07-16",
    topic: "pg workflow",
    text: "hello",
  });
  assert.equal(item.status, "draft");
  assert.equal((await svc.submit(item.id)).status, "review");
  assert.equal((await svc.approve(item.id)).status, "approved");
  const pub = await svc.publish(item.id, { confirm: true, postUrl: "https://x.com/p/1" });
  assert.equal(pub.status, "published");
  assert.equal(pub.postUrl, "https://x.com/p/1");
  assert.ok(pub.publishedAt);
  assert.equal((await svc.archive(item.id)).status, "archived");
});

/* row/model mapping through a real database */
test("mapping round-trips through PostgreSQL", { skip }, async () => {
  const svc = await freshPgService();
  const { item } = await svc.createDraft({
    stream: "coffee-break-build",
    plannedDate: "2026-07-16",
    topic: "mapping",
    category: "Coffee Break Build",
    text: "body text",
    imageRequired: true,
    imageBrief: "an image brief",
    seriesNumber: 2,
    similarityKeys: { opening: "the opening", centralLesson: "the lesson" },
  });
  const back = await svc.getItem(item.id);
  assert.equal(back.stream, "coffee-break-build");
  assert.equal(back.seriesNumber, 2);
  assert.equal(back.plannedDate, "2026-07-16");
  assert.equal(back.imageRequired, true);
  assert.equal(back.imageBrief, "an image brief");
  assert.equal(back.similarityKeys.opening, "the opening");
  assert.equal(back.similarityKeys.centralLesson, "the lesson");
  assert.ok(Array.isArray(back.history));
});

/* 7. seed idempotency */
test("seed is idempotent across repeated init", { skip }, async () => {
  const svc = await freshPgService();
  await svc.init();
  await svc.init();
  const all = await svc.listItems();
  const seeds = all.filter((i) => i.id === SEED_CBB_001_ID);
  assert.equal(seeds.length, 1);
  const seed = seeds[0];
  assert.equal(seed.status, "published");
  assert.equal(seed.seriesNumber, 1);
  assert.equal(String(seed.publishedAt).slice(0, 10), "2026-07-15");
});

/* 8. seed does not overwrite later edits */
test("re-seeding does not overwrite an edited seed record", { skip }, async () => {
  const svc = await freshPgService();
  // simulate a later manual edit to the seed's unresolved text
  const seed = await svc.getItem(SEED_CBB_001_ID);
  seed.text = "the real published text";
  seed.postUrl = "https://x.com/p/001";
  await svc.repo.save(seed);
  // re-run init/seed
  await svc.seedDefaults();
  const after = await svc.getItem(SEED_CBB_001_ID);
  assert.equal(after.text, "the real published text");
  assert.equal(after.postUrl, "https://x.com/p/001");
});

/* 13. published Coffee Break Build number uniqueness (DB index) */
test("DB rejects two published CBB items with the same number", { skip }, async () => {
  const svc = await freshPgService();
  const repo = svc.repo;
  const { createItem } = require("../src/publishing/model");
  const a = createItem({ stream: "coffee-break-build", plannedDate: "2026-07-16", topic: "a", status: "published", seriesNumber: 5, publishedAt: "2026-07-16T00:00:00.000Z" });
  const b = createItem({ stream: "coffee-break-build", plannedDate: "2026-07-16", topic: "b", status: "published", seriesNumber: 5, publishedAt: "2026-07-16T00:00:00.000Z" });
  await repo.create(a);
  await assert.rejects(() => repo.create(b), /conflict|already taken/i);
});

/* 14. concurrent publish protection */
test("concurrent publish of the same reserved number yields exactly one winner", { skip }, async () => {
  const svc = await freshPgService();
  const { item: a } = await svc.createDraft({ stream: "coffee-break-build", plannedDate: "2026-07-16", topic: "concurrent a", text: "x", seriesNumber: 2 });
  const { item: b } = await svc.createDraft({ stream: "coffee-break-build", plannedDate: "2026-07-16", topic: "concurrent b", text: "y", seriesNumber: 2 });
  for (const id of [a.id, b.id]) {
    await svc.submit(id);
    await svc.approve(id);
  }
  const results = await Promise.allSettled([
    svc.publish(a.id, { confirm: true }),
    svc.publish(b.id, { confirm: true }),
  ]);
  const fulfilled = results.filter((r) => r.status === "fulfilled");
  const rejected = results.filter((r) => r.status === "rejected");
  assert.equal(fulfilled.length, 1, "exactly one publish should succeed");
  assert.equal(rejected.length, 1, "exactly one publish should be rejected");

  const publishedCount = (await svc.listItems({ stream: "coffee-break-build", status: "published" }))
    .filter((i) => i.seriesNumber === 2).length;
  assert.equal(publishedCount, 1);
});

/* 15. atomic publish (illegal publish leaves no partial state) */
test("illegal publish is atomic and changes nothing", { skip }, async () => {
  const svc = await freshPgService();
  const { item } = await svc.createDraft({ stream: "orok-morning", plannedDate: "2026-07-16", topic: "atomic", text: "z" });
  await assert.rejects(() => svc.publish(item.id, { confirm: true }));
  const after = await svc.getItem(item.id);
  assert.equal(after.status, "draft");
  assert.equal(after.publishedAt, undefined);
  assert.equal(after.postUrl, undefined);
});

/* 16. health endpoint success against a real, migrated database */
test("health reports ok against a migrated database", { skip }, async () => {
  const svc = await freshPgService();
  const h = await svc.health();
  assert.equal(h.ok, true);
  assert.equal(h.storage, "postgres");
  assert.equal(h.databaseReachable, true);
  assert.equal(h.migrationsCurrent, true);
});

/* 6. idempotent migrations against a real database */
test("running migrations again applies nothing new", { skip }, async () => {
  const { applied } = await runMigrations(pool);
  assert.equal(applied.length, 0);
});

/* filtering via SQL */
test("SQL filtering by stream/status/date/topic", { skip }, async () => {
  const svc = await freshPgService();
  await svc.createDraft({ stream: "orok-morning", plannedDate: "2026-07-16", topic: "discipline", text: "d" });
  await svc.createDraft({ stream: "saturday-mixed", plannedDate: "2026-07-18", topic: "weekend recap", text: "w" });

  assert.ok((await svc.listItems({ stream: "orok-morning" })).every((i) => i.stream === "orok-morning"));
  assert.ok((await svc.listItems({ status: "published" })).some((i) => i.id === SEED_CBB_001_ID));
  assert.ok((await svc.listItems({ date: "2026-07-18" })).every((i) => String(i.plannedDate).slice(0, 10) === "2026-07-18"));
  const byTopic = await svc.listItems({ topic: "recap" });
  assert.ok(byTopic.some((i) => i.topic === "weekend recap"));
  assert.ok(!byTopic.some((i) => i.topic === "discipline"));
});
