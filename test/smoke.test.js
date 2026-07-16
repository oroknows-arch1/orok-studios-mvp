"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

// Configure BEFORE requiring the app.
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || "test-dummy-key";
process.env.PUBLISHING_STORAGE = "memory";
delete process.env.NODE_ENV; // ensure not production so memory storage is allowed

const app = require("../server");
const { runSmokeTest } = require("../src/publishing/smoke");

let server;
let base;
const requestedUrls = [];

// fetch wrapper that records every URL the smoke test requests
const recordingFetch = (url, opts) => {
  requestedUrls.push(String(url));
  return fetch(url, opts);
};

test.before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      base = "http://127.0.0.1:" + server.address().port;
      resolve();
    });
  });
});

test.after(() => {
  if (server) server.close();
});

/* 12. smoke-test controlled draft lifecycle */
test("smoke test runs the controlled draft lifecycle and passes", async () => {
  const result = await runSmokeTest({ baseUrl: base, fetchImpl: recordingFetch });
  const byName = {};
  for (const r of result.results) byName[r.name] = r;

  assert.equal(result.ok, true, JSON.stringify(result.results.filter((r) => !r.ok)));
  assert.equal(byName["create controlled draft"].ok, true);
  assert.equal(byName["retrieve controlled draft"].ok, true);
  assert.equal(byName["edit controlled draft"].ok, true);
  assert.equal(byName["archive controlled draft"].ok, true);
  assert.equal(byName["Coffee Break Build #001 present & published"].ok, true);
});

/* 13. smoke test never calls generation endpoints */
test("smoke test never calls generation, image, or approve/publish endpoints", async () => {
  requestedUrls.length = 0;
  await runSmokeTest({ baseUrl: base, fetchImpl: recordingFetch });
  const joined = requestedUrls.join("\n");
  assert.ok(!/\/generate(\b|-image)/.test(joined), "must not call /generate or /generate-image");
  assert.ok(!/\/analyze-voice/.test(joined), "must not call /analyze-voice");
  assert.ok(!/\/approve\b/.test(joined), "must not approve");
  assert.ok(!/\/publish\b/.test(joined), "must not publish");
});

/* the smoke test must not alter Coffee Break Build #001 */
test("smoke test leaves Coffee Break Build #001 unchanged", async () => {
  const before = await (await fetch(base + "/api/publishing/items/seed-coffee-break-build-001")).json();
  await runSmokeTest({ baseUrl: base, fetchImpl: recordingFetch });
  const after = await (await fetch(base + "/api/publishing/items/seed-coffee-break-build-001")).json();
  assert.equal(after.item.status, before.item.status);
  assert.equal(after.item.seriesNumber, before.item.seriesNumber);
  assert.equal(after.item.version, before.item.version);
});
