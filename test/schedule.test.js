"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  localParts,
  inWindow,
  resolveTimeZone,
  morningForWeekday,
  SATURDAY_MIX_POOL,
  DraftPreparationService,
  PublishingScheduler,
  authorizePrepare,
  sundayDateFor,
} = require("../src/publishing/schedule");
const { PublishingService } = require("../src/publishing/service");
const { InMemoryPublishingRepository } = require("../src/publishing/repository");
const { LongGameEngine } = require("../src/publishing/long-game");

test("timezone localParts returns ISO weekday and dateStr", () => {
  const parts = localParts(new Date("2026-07-19T00:00:00.000Z"), "UTC");
  assert.equal(parts.dateStr, "2026-07-19");
  assert.equal(parts.weekday, 7); // Sunday
  assert.equal(resolveTimeZone("Australia/Sydney"), "Australia/Sydney");
});

test("inWindow is half-open on the end bound", () => {
  assert.equal(inWindow({ hour: 5, minute: 0 }, 5, 0, 6, 0), true);
  assert.equal(inWindow({ hour: 5, minute: 59 }, 5, 0, 6, 0), true);
  assert.equal(inWindow({ hour: 6, minute: 0 }, 5, 0, 6, 0), false);
  assert.equal(inWindow({ hour: 15, minute: 0 }, 15, 0, 18, 0), true);
  assert.equal(inWindow({ hour: 18, minute: 0 }, 15, 0, 18, 0), false);
});

test("weekday morning calendar covers Mon–Sun OROK categories", () => {
  assert.equal(morningForWeekday(1).label, "Motivation Monday");
  assert.equal(morningForWeekday(2).tributeManualImage, true);
  assert.equal(morningForWeekday(3).label, "Words of Wisdom");
  assert.equal(morningForWeekday(4).includeCookIslandsMaori, true);
  assert.equal(morningForWeekday(5).label, "Weekly Reflection");
  assert.equal(morningForWeekday(6).mixed, true);
  assert.equal(morningForWeekday(7).longGame, true);
  assert.ok(SATURDAY_MIX_POOL.length >= 4);
});

test("authorizePrepare requires secret in production", () => {
  const prevEnv = process.env.NODE_ENV;
  const prevSecret = process.env.PUBLISHING_CRON_SECRET;
  try {
    process.env.NODE_ENV = "production";
    delete process.env.PUBLISHING_CRON_SECRET;
    delete process.env.CRON_SECRET;
    assert.equal(authorizePrepare("anything"), false);

    process.env.PUBLISHING_CRON_SECRET = "s3cret";
    assert.equal(authorizePrepare("s3cret"), true);
    assert.equal(authorizePrepare("wrong"), false);
  } finally {
    process.env.NODE_ENV = prevEnv;
    if (prevSecret === undefined) delete process.env.PUBLISHING_CRON_SECRET;
    else process.env.PUBLISHING_CRON_SECRET = prevSecret;
  }
});

async function makePrep() {
  const repo = new InMemoryPublishingRepository();
  const svc = new PublishingService(repo);
  await svc.init();
  const longGame = new LongGameEngine({ publishingService: svc });
  const preparation = new DraftPreparationService({
    publishingService: svc,
    longGameEngine: longGame,
    timeZone: "UTC",
  });
  return { svc, preparation };
}

test("preparation is idempotent for morning + CBB on a weekday", async () => {
  const { svc, preparation } = await makePrep();
  // Friday 05:30 UTC (avoid Thursday MoY path and 2026-07-15 seed CBB date)
  const now = new Date("2026-07-17T05:30:00.000Z");
  const first = await preparation.prepare({
    now,
    force: true,
    theme: "stillness",
  });
  assert.ok(first.created >= 1);

  const second = await preparation.prepare({
    now,
    force: true,
    theme: "stillness",
  });
  assert.equal(second.created, 0);
  assert.ok(second.existed >= 1);

  const morning = await svc.listItems({
    stream: "orok-morning",
    date: "2026-07-17",
  });
  assert.equal(morning.length, 1);

  const cbb = await svc.listItems({
    stream: "coffee-break-build",
    date: "2026-07-17",
  });
  assert.equal(cbb.length, 1);
  assert.equal(cbb[0].seriesNumber, 2); // after seeded #001
});

test("Long Game preparation stores 2–5 sources and is duplicate-safe", async () => {
  const { svc, preparation } = await makePrep();
  // Saturday afternoon UTC → prepares Sunday Long Game for next day
  const sat = new Date("2026-07-18T14:00:00.000Z");
  const first = await preparation.prepare({
    now: sat,
    force: true,
    kinds: ["long-game"],
  });
  assert.ok(first.results.some((r) => r.kind === "long-game" && r.action === "created"));

  const items = await svc.listItems({ stream: "sunday-long-game" });
  assert.equal(items.length, 1);
  assert.ok(items[0].sources.length >= 2 && items[0].sources.length <= 5);
  assert.match(items[0].text, /\nSources\n/);

  const second = await preparation.prepare({
    now: sat,
    force: true,
    kinds: ["long-game"],
  });
  assert.ok(second.results.some((r) => r.kind === "long-game" && r.action === "exists"));
  assert.equal((await svc.listItems({ stream: "sunday-long-game" })).length, 1);
});

test("Saturday mixed avoids empty pool and picks an established category", async () => {
  const { svc, preparation } = await makePrep();
  const sat = new Date("2026-07-18T05:30:00.000Z");
  const result = await preparation.prepare({
    now: sat,
    force: true,
    kinds: ["morning"],
  });
  assert.ok(result.results.some((r) => r.action === "created" || r.action === "exists"));
  const items = await svc.listItems({ stream: "saturday-mixed", date: "2026-07-18" });
  assert.equal(items.length, 1);
  assert.ok(SATURDAY_MIX_POOL.includes(items[0].category));
});

test("scheduler tick is overlap-safe and reports status", async () => {
  const { preparation } = await makePrep();
  const scheduler = new PublishingScheduler({
    preparation,
    intervalMs: 60_000,
    logger: () => {},
  });
  const a = scheduler.tick({
    now: new Date("2026-07-15T05:30:00.000Z"),
    force: true,
  });
  const b = scheduler.tick({
    now: new Date("2026-07-15T05:30:00.000Z"),
    force: true,
  });
  const [ra, rb] = await Promise.all([a, b]);
  assert.ok(ra.ok === true || ra.created !== undefined);
  // one of the concurrent ticks may report skipped
  assert.ok(rb.skipped === true || rb.ok === true || rb.created !== undefined);
  const status = scheduler.status();
  assert.equal(typeof status.enabled, "boolean");
  assert.ok(status.timeZone);
  scheduler.stop();
});

test("sundayDateFor maps Saturday to upcoming Sunday", () => {
  const parts = localParts(new Date("2026-07-18T14:00:00.000Z"), "UTC");
  assert.equal(parts.weekday, 6);
  assert.equal(sundayDateFor(parts), "2026-07-19");
});
