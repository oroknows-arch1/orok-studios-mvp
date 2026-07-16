"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { PublishingService, SEED_CBB_001_ID } = require("../src/publishing/service");
const { InMemoryPublishingRepository } = require("../src/publishing/repository");
const { ValidationError } = require("../src/publishing/validation");
const { TransitionError } = require("../src/publishing/transitions");

async function freshService() {
  const svc = new PublishingService(new InMemoryPublishingRepository());
  await svc.init();
  return svc;
}

/* 11. Seeded Coffee Break Build #001 */
test("seeds Coffee Break Build #001 as published on 2026-07-15", async () => {
  const svc = await freshService();
  const seed = await svc.getItem(SEED_CBB_001_ID);
  assert.ok(seed, "seed item should exist");
  assert.equal(seed.stream, "coffee-break-build");
  assert.equal(seed.seriesNumber, 1);
  assert.equal(seed.status, "published");
  assert.equal(String(seed.publishedAt).slice(0, 10), "2026-07-15");
  assert.equal(seed.text, "", "final text left unresolved");
  assert.equal(seed.postUrl, "", "post URL left unresolved");
});

test("seeding is idempotent", async () => {
  const repo = new InMemoryPublishingRepository();
  const svc = new PublishingService(repo);
  await svc.init();
  await svc.init();
  const all = await svc.listItems();
  const seeds = all.filter((i) => i.seriesNumber === 1 && i.stream === "coffee-break-build");
  assert.equal(seeds.length, 1);
});

/* 3/4. next number after seed */
test("next Coffee Break number after seed is 2", async () => {
  const svc = await freshService();
  assert.equal(await svc.suggestSeriesNumber("coffee-break-build"), 2);
  assert.equal(await svc.suggestSeriesNumber("orok-morning"), null);
});

test("creating a CBB draft auto-suggests the next number and reserving/rejecting frees it", async () => {
  const svc = await freshService();
  const { item } = await svc.createDraft({
    stream: "coffee-break-build",
    plannedDate: "2026-07-16",
    topic: "next build",
    text: "hello",
  });
  assert.equal(item.seriesNumber, 2);
  assert.equal(await svc.suggestSeriesNumber("coffee-break-build"), 3);

  await svc.reject(item.id, "not ready");
  // number released back to 2
  assert.equal(await svc.suggestSeriesNumber("coffee-break-build"), 2);
});

/* 5. published entry retains its number */
test("publishing a reserved CBB draft keeps its number permanently", async () => {
  const svc = await freshService();
  const { item } = await svc.createDraft({ stream: "coffee-break-build", plannedDate: "2026-07-16", topic: "t", text: "x" });
  await svc.submit(item.id);
  await svc.approve(item.id);
  const published = await svc.publish(item.id, { confirm: true, publishedAt: "2026-07-16T09:00:00.000Z" });
  assert.equal(published.status, "published");
  assert.equal(published.seriesNumber, 2);
  assert.equal(await svc.suggestSeriesNumber("coffee-break-build"), 3);
});

/* 6. Explicit publication requirement */
test("cannot publish directly from draft/review (must be approved)", async () => {
  const svc = await freshService();
  const { item } = await svc.createDraft({ stream: "orok-morning", plannedDate: "2026-07-16", topic: "t", text: "x" });
  await assert.rejects(() => svc.publish(item.id, { confirm: true }), TransitionError);
  await svc.submit(item.id);
  await assert.rejects(() => svc.publish(item.id, { confirm: true }), TransitionError);
});

test("PATCH cannot set status to published (no silent publish)", async () => {
  const svc = await freshService();
  const { item } = await svc.createDraft({ stream: "orok-morning", plannedDate: "2026-07-16", topic: "t", text: "x" });
  await assert.rejects(() => svc.updateItem(item.id, { status: "published" }), ValidationError);
});

test("publish with confirm:false is refused", async () => {
  const svc = await freshService();
  const { item } = await svc.createDraft({ stream: "orok-morning", plannedDate: "2026-07-16", topic: "t", text: "x" });
  await svc.submit(item.id);
  await svc.approve(item.id);
  await assert.rejects(() => svc.publish(item.id, { confirm: false }), ValidationError);
});

test("new items may not be created already approved/published", async () => {
  const svc = await freshService();
  await assert.rejects(
    () => svc.createDraft({ stream: "orok-morning", plannedDate: "2026-07-16", topic: "t", text: "x", status: "approved" }),
    ValidationError
  );
});

/* 7. Rejection-reason requirement */
test("reject requires a non-empty reason", async () => {
  const svc = await freshService();
  const { item } = await svc.createDraft({ stream: "orok-morning", plannedDate: "2026-07-16", topic: "t", text: "x" });
  await assert.rejects(() => svc.reject(item.id, ""), ValidationError);
  await assert.rejects(() => svc.reject(item.id, "   "), ValidationError);
  const rejected = await svc.reject(item.id, "duplicate topic");
  assert.equal(rejected.status, "rejected");
  assert.equal(rejected.rejectionReason, "duplicate topic");
});

test("rejected items remain recorded", async () => {
  const svc = await freshService();
  const { item } = await svc.createDraft({ stream: "orok-morning", plannedDate: "2026-07-16", topic: "t", text: "x" });
  await svc.reject(item.id, "off-brand");
  const still = await svc.getItem(item.id);
  assert.ok(still);
  assert.equal(still.status, "rejected");
});

/* version history on edit */
test("editing text bumps version and records history", async () => {
  const svc = await freshService();
  const { item } = await svc.createDraft({ stream: "orok-morning", plannedDate: "2026-07-16", topic: "t", text: "first" });
  assert.equal(item.version, 1);
  const updated = await svc.updateItem(item.id, { text: "second" });
  assert.equal(updated.version, 2);
  assert.equal(updated.history.length, 1);
  assert.equal(updated.history[0].text, "first");
});

/* 8. Dashboard totals */
test("dashboard reports correct totals", async () => {
  const svc = await freshService();
  await svc.createDraft({ stream: "orok-morning", plannedDate: "2026-07-16", topic: "morning", text: "m" });
  const { item: r } = await svc.createDraft({ stream: "saturday-mixed", plannedDate: "2026-07-18", topic: "sat", text: "s" });
  await svc.submit(r.id); // review
  const { item: a } = await svc.createDraft({ stream: "sunday-long-game", plannedDate: "2026-07-19", topic: "sun", text: "l" });
  await svc.submit(a.id);
  await svc.approve(a.id); // approved

  const d = await svc.dashboard({ today: "2026-07-16" });
  assert.equal(d.today, "2026-07-16");
  assert.equal(d.awaitingReview, 1);
  assert.equal(d.approved, 1);
  assert.equal(d.nextCoffeeBreakNumber, 2);
  assert.ok(d.morningPost, "morning post present for today");
  assert.equal(d.morningPost.topic, "morning");
  // seed CBB #001 published 2026-07-15 falls in the week of 2026-07-16 (Mon 13th-Sun 19th)
  assert.equal(d.publishedThisWeek, 1);
});

/* 9. Stream and status filtering */
test("filters by stream, status, date and topic search", async () => {
  const svc = await freshService();
  await svc.createDraft({ stream: "orok-morning", plannedDate: "2026-07-16", topic: "discipline", text: "d" });
  await svc.createDraft({ stream: "saturday-mixed", plannedDate: "2026-07-18", topic: "weekend recap", text: "w" });

  const byStream = await svc.listItems({ stream: "orok-morning" });
  assert.ok(byStream.every((i) => i.stream === "orok-morning"));

  const byStatus = await svc.listItems({ status: "published" });
  assert.ok(byStatus.every((i) => i.status === "published"));
  assert.ok(byStatus.some((i) => i.id === SEED_CBB_001_ID));

  const byDate = await svc.listItems({ date: "2026-07-18" });
  assert.ok(byDate.every((i) => String(i.plannedDate).slice(0, 10) === "2026-07-18"));

  const byTopic = await svc.listItems({ topic: "recap" });
  assert.ok(byTopic.some((i) => i.topic === "weekend recap"));
  assert.ok(!byTopic.some((i) => i.topic === "discipline"));
});

test("full happy-path lifecycle", async () => {
  const svc = await freshService();
  const { item } = await svc.createDraft({ stream: "orok-morning", plannedDate: "2026-07-16", topic: "t", text: "hello" });
  assert.equal(item.status, "draft");
  assert.equal((await svc.submit(item.id)).status, "review");
  assert.equal((await svc.approve(item.id)).status, "approved");
  const pub = await svc.publish(item.id, { confirm: true, postUrl: "https://x.com/p/1" });
  assert.equal(pub.status, "published");
  assert.equal(pub.postUrl, "https://x.com/p/1");
  assert.equal((await svc.archive(item.id)).status, "archived");
});
