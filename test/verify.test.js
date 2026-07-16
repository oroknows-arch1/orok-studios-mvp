"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { runVerification } = require("../src/publishing/verify");
const { PublishingService } = require("../src/publishing/service");
const { InMemoryPublishingRepository } = require("../src/publishing/repository");
const { createItem } = require("../src/publishing/model");

function checkMap(result) {
  const map = {};
  for (const c of result.checks) map[c.name] = c;
  return map;
}

/* 9. read-only publishing verification success */
test("verification passes on a seeded, valid store", async () => {
  const repo = new InMemoryPublishingRepository();
  const svc = new PublishingService(repo);
  await svc.init(); // seeds CBB #001

  const before = await svc.listItems();
  const result = await runVerification(svc);
  const after = await svc.listItems();

  assert.equal(result.ok, true, JSON.stringify(result.checks));
  // read-only: item count unchanged
  assert.equal(after.length, before.length);
});

/* 10. verification detecting a missing seed */
test("verification fails when Coffee Break Build #001 is missing", async () => {
  const repo = new InMemoryPublishingRepository(); // no seeding
  const svc = new PublishingService(repo);
  // deliberately do NOT call init(), so no seed exists
  const result = await runVerification(svc);
  const map = checkMap(result);
  assert.equal(result.ok, false);
  assert.equal(map["Coffee Break Build #001 exists"].ok, false);
});

/* 11. verification detecting duplicate published numbers */
test("verification detects duplicate published Coffee Break Build numbers", async () => {
  const repo = new InMemoryPublishingRepository();
  const svc = new PublishingService(repo);
  await svc.init();
  // inject a second published #1 directly via the repository (bypassing rules)
  const dupe = createItem({
    id: "dupe-cbb-1",
    stream: "coffee-break-build",
    plannedDate: "2026-07-16",
    topic: "dupe",
    status: "published",
    seriesNumber: 1,
    publishedAt: "2026-07-16T00:00:00.000Z",
  });
  await repo.create(dupe);

  const result = await runVerification(svc);
  const map = checkMap(result);
  assert.equal(result.ok, false);
  assert.equal(map["no duplicate published Coffee Break Build numbers"].ok, false);
});

test("verification detects invalid stored records", async () => {
  const repo = new InMemoryPublishingRepository();
  const svc = new PublishingService(repo);
  await svc.init();
  // inject an invalid record directly
  await repo.create({ id: "bad-1", stream: "nope", status: "weird", topic: "" });
  const result = await runVerification(svc);
  const map = checkMap(result);
  assert.equal(result.ok, false);
  assert.equal(map["all stored records satisfy model validation"].ok, false);
});
