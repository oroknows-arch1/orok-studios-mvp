"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");

const { createPublishing } = require("../src/publishing");
const { StubPostGenerator } = require("../src/generator");
const { InMemoryPublishingRepository } = require("../src/publishing/repository");

async function startApp(withGenerator = true) {
  const repository = new InMemoryPublishingRepository();
  const publishing = createPublishing({
    repository,
    postGenerator: withGenerator ? new StubPostGenerator() : null,
  });
  await publishing.ready;

  const app = express();
  app.use(express.json());
  app.use("/api/publishing", publishing.router);

  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = "http://127.0.0.1:" + server.address().port;
  return {
    base,
    close: async () => {
      await new Promise((r) => server.close(r));
      await publishing.close();
    },
  };
}

test("POST /api/publishing/generate/preview returns candidates", async () => {
  const { base, close } = await startApp(true);
  try {
    const res = await fetch(base + "/api/publishing/generate/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        idea: "consistency",
        category: "Motivation Monday",
      }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.candidates.length, 3);
    assert.ok(body.generationId, "preview must return generationId for cost ledger");
    assert.ok(body.usage, "preview must return usage metadata");
    assert.equal(typeof body.usage.estimatedCostUsd, "number");
  } finally {
    await close();
  }
});

test("POST /api/publishing/generate creates review-queue item (never approved/published)", async () => {
  const { base, close } = await startApp(true);
  try {
    const res = await fetch(base + "/api/publishing/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        stream: "orok-morning",
        plannedDate: "2026-07-16",
        idea: "http generated draft",
        category: "Motivation Monday",
        selectedIndex: 1,
      }),
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.item.status, "review");
    assert.notEqual(body.item.status, "approved");
    assert.notEqual(body.item.status, "published");
    assert.equal(body.selectedIndex, 1);
    assert.ok(body.item.text);

    // Appears in today's queue listing
    const list = await fetch(
      base + "/api/publishing/items?date=2026-07-16&status=review"
    );
    const listed = await list.json();
    assert.ok(listed.items.some((i) => i.id === body.item.id));
  } finally {
    await close();
  }
});

test("POST /api/publishing/generate with text skips OpenAI and queues review", async () => {
  const { base, close } = await startApp(true);
  try {
    const preview = await fetch(base + "/api/publishing/generate/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        idea: "cbb generated",
        category: "Friday Freestyle",
        stream: "coffee-break-build",
      }),
    });
    const prev = await preview.json();
    const text = prev.candidates[0];
    const res = await fetch(base + "/api/publishing/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        stream: "coffee-break-build",
        plannedDate: "2026-07-16",
        topic: "cbb generated",
        category: "Friday Freestyle",
        text,
        generationId: prev.generationId,
        placeInReview: true,
      }),
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.item.status, "review");
    assert.equal(body.item.seriesNumber, 2);
    assert.equal(body.item.text, text);
    assert.equal(body.candidates, null);
    assert.equal(body.generationRequestPerformed, false);
  } finally {
    await close();
  }
});

test("generation endpoints return 503 when generator is not configured", async () => {
  const { base, close } = await startApp(false);
  try {
    const preview = await fetch(base + "/api/publishing/generate/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idea: "x", category: "Motivation Monday" }),
    });
    assert.equal(preview.status, 503);

    const create = await fetch(base + "/api/publishing/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        stream: "orok-morning",
        plannedDate: "2026-07-16",
        idea: "x",
        category: "Motivation Monday",
      }),
    });
    assert.equal(create.status, 503);
  } finally {
    await close();
  }
});

test("invalid generation body returns 400", async () => {
  const { base, close } = await startApp(true);
  try {
    const res = await fetch(base + "/api/publishing/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stream: "nope", plannedDate: "bad" }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.ok(Array.isArray(body.errors));
  } finally {
    await close();
  }
});
