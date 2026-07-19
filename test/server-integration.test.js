"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

// Configure BEFORE requiring the app so module-load side effects use safe values.
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || "test-dummy-key";
process.env.PUBLISHING_STORAGE = "memory";

const app = require("../server");

let server;
let base;

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

/* 12. Existing functionality remains operational */
test("existing static index page is still served at /", async () => {
  const res = await fetch(base + "/");
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(html.includes("OROK Studios"));
  assert.ok(html.includes("Create Post"));
});

test("existing generator routes are still registered (not 404)", async () => {
  // These call OpenAI with a dummy key and will error (500), but the routes
  // must still exist — a 404 would mean we broke the generator wiring.
  const gen = await fetch(base + "/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idea: "x", category: "Motivation Monday" }),
  });
  assert.notEqual(gen.status, 404);

  const img = await fetch(base + "/generate-image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imagePrompt: "x" }),
  });
  assert.notEqual(img.status, 404);
});

/* Publishing is a capability of the original app — not a separate SPA */
test("standalone /publishing redirects into the original app", async () => {
  const res = await fetch(base + "/publishing", { redirect: "manual" });
  assert.ok([301, 302].includes(res.status));
  const loc = res.headers.get("location") || "";
  assert.ok(loc.includes("/#today") || loc.endsWith("/"), loc);
});

test("original app UI exposes publishing panels", async () => {
  const res = await fetch(base + "/");
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(html.includes("Create Post"));
  assert.ok(html.includes('data-panel="today"'));
  assert.ok(html.includes('data-panel="ledger"'));
  assert.ok(html.includes('data-panel="review"'));
  assert.ok(!html.includes("Publishing v0.1 · local · manual approval"));
});

test("publishing health endpoint works with the memory adapter", async () => {
  const res = await fetch(base + "/api/publishing/health");
  assert.equal(res.status, 200);
  const h = await res.json();
  assert.equal(h.ok, true);
  assert.equal(h.storage, "memory");
  assert.equal(h.databaseReachable, true);
  assert.equal(h.migrationsCurrent, true);
});

test("publishing dashboard endpoint works", async () => {
  const res = await fetch(base + "/api/publishing/dashboard");
  assert.equal(res.status, 200);
  const d = await res.json();
  assert.ok("nextCoffeeBreakNumber" in d);
  assert.equal(d.nextCoffeeBreakNumber, 2);
});

test("create -> submit -> approve -> publish over HTTP", async () => {
  const create = await fetch(base + "/api/publishing/items", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ stream: "orok-morning", plannedDate: "2026-07-16", topic: "http lifecycle", text: "hi" }),
  });
  assert.equal(create.status, 201);
  const { item } = await create.json();

  const submit = await fetch(base + "/api/publishing/items/" + item.id + "/submit", { method: "POST" });
  assert.equal(submit.status, 200);
  const approve = await fetch(base + "/api/publishing/items/" + item.id + "/approve", { method: "POST" });
  assert.equal(approve.status, 200);

  const publish = await fetch(base + "/api/publishing/items/" + item.id + "/publish", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ confirm: true, postUrl: "https://x.com/p/2" }),
  });
  assert.equal(publish.status, 200);
  const pub = await publish.json();
  assert.equal(pub.item.status, "published");
});

test("illegal transition over HTTP returns 409", async () => {
  const create = await fetch(base + "/api/publishing/items", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ stream: "orok-morning", plannedDate: "2026-07-16", topic: "bad", text: "hi" }),
  });
  const { item } = await create.json();
  const publish = await fetch(base + "/api/publishing/items/" + item.id + "/publish", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ confirm: true }),
  });
  assert.equal(publish.status, 409);
});

test("invalid create body returns 400 with errors", async () => {
  const res = await fetch(base + "/api/publishing/items", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ stream: "nope", topic: "" }),
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.ok(Array.isArray(body.errors) && body.errors.length > 0);
});
