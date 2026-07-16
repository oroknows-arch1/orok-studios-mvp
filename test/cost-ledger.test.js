"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");

const {
  estimateCostUsd,
  getModelPricing,
  createUsageRecord,
  mapOpenAIUsage,
  InMemoryCostLedgerRepository,
  buildSummary,
  filterByDateRange,
} = require("../src/publishing/costs");
const { PublishingService } = require("../src/publishing/service");
const { InMemoryPublishingRepository } = require("../src/publishing/repository");
const { PublishingGenerationService } = require("../src/publishing/generation-service");
const { StubPostGenerator } = require("../src/generator");
const { loadMigrations, computePending } = require("../src/publishing/db/migrate");
const { createPublishing } = require("../src/publishing");

/* ---------- pricing ---------- */

test("deterministic cost calculation from canonical pricing", () => {
  const pricing = getModelPricing("gpt-4.1-mini");
  assert.ok(pricing);
  const cost = estimateCostUsd({
    model: "gpt-4.1-mini",
    inputTokens: 1_000_000,
    outputTokens: 1_000_000,
  });
  assert.equal(
    cost,
    pricing.inputUsdPerMillionTokens + pricing.outputUsdPerMillionTokens
  );

  const small = estimateCostUsd({
    model: "gpt-4.1-mini",
    inputTokens: 1200,
    outputTokens: 450,
  });
  const expectedSmall =
    Math.round(
      ((1200 / 1_000_000) * pricing.inputUsdPerMillionTokens +
        (450 / 1_000_000) * pricing.outputUsdPerMillionTokens) *
        1e8
    ) / 1e8;
  assert.equal(small, expectedSmall);
});

test("unknown model pricing records null estimatedCostUsd", () => {
  assert.equal(getModelPricing("totally-unknown-model-xyz"), null);
  assert.equal(
    estimateCostUsd({
      model: "totally-unknown-model-xyz",
      inputTokens: 100,
      outputTokens: 50,
    }),
    null
  );
  const record = createUsageRecord({
    model: "totally-unknown-model-xyz",
    inputTokens: 100,
    outputTokens: 50,
    status: "generated",
  });
  assert.equal(record.estimatedCostUsd, null);
  assert.equal(record.inputTokens, 100);
  assert.equal(record.outputTokens, 50);
});

test("OpenAI usage mapping prefers provider token fields", () => {
  const mapped = mapOpenAIUsage({
    model: "gpt-4.1-mini-2025-04-14",
    usage: {
      prompt_tokens: 111,
      completion_tokens: 222,
      total_tokens: 333,
    },
  });
  assert.equal(mapped.model, "gpt-4.1-mini-2025-04-14");
  assert.equal(mapped.inputTokens, 111);
  assert.equal(mapped.outputTokens, 222);
  assert.equal(mapped.totalTokens, 333);
  assert.equal(mapped.provider, "openai");
});

test("stub usage mapping is deterministic without OpenAI", async () => {
  const gen = new StubPostGenerator();
  const result = await gen.generatePosts({
    idea: "x",
    category: "Motivation Monday",
  });
  assert.equal(result.usage.model, "gpt-4.1-mini");
  assert.equal(result.usage.inputTokens, 1200);
  assert.equal(result.usage.outputTokens, 450);
  assert.equal(result.usage.totalTokens, 1650);
});

/* ---------- ledger behaviour via generation service ---------- */

async function freshGen(opts = {}) {
  const publishingService = new PublishingService(new InMemoryPublishingRepository());
  await publishingService.init();
  const costRepository =
    opts.costRepository === undefined
      ? new InMemoryCostLedgerRepository()
      : opts.costRepository;
  const postGenerator = opts.postGenerator || new StubPostGenerator();
  const logs = [];
  const generationService = new PublishingGenerationService({
    publishingService,
    postGenerator,
    costRepository,
    logger: (msg, meta) => logs.push({ msg, meta }),
  });
  return { publishingService, costRepository, postGenerator, generationService, logs };
}

test("one ledger record per generation request; selecting candidate creates none", async () => {
  const { generationService, costRepository, postGenerator } = await freshGen();
  const preview = await generationService.preview({
    idea: "consistency",
    category: "Motivation Monday",
    stream: "orok-morning",
  });
  assert.ok(preview.generationId);
  assert.equal(preview.usage.inputTokens, 1200);
  assert.equal((await costRepository.listRecent()).length, 1);
  assert.equal(postGenerator.calls, 1);

  const queued = await generationService.generateDraft({
    stream: "orok-morning",
    plannedDate: "2026-07-16",
    topic: "consistency",
    category: "Motivation Monday",
    text: preview.candidates[0],
    generationId: preview.generationId,
  });
  assert.equal(queued.item.status, "review");
  assert.equal(queued.generationRequestPerformed, false);
  assert.equal(postGenerator.calls, 1, "must not call OpenAI again when selecting");
  assert.equal((await costRepository.listRecent()).length, 1, "no extra cost row");

  const row = await costRepository.getByGenerationId(preview.generationId);
  assert.equal(row.status, "accepted");
  assert.equal(row.publishingItemId, queued.item.id);
});

test("accepted status when draft enters review; discarded status supported", async () => {
  const { generationService, costRepository } = await freshGen();
  const preview = await generationService.preview({
    idea: "a",
    category: "Motivation Monday",
    stream: "orok-morning",
  });
  assert.equal(
    (await costRepository.getByGenerationId(preview.generationId)).status,
    "generated"
  );

  await generationService.discardGeneration(preview.generationId);
  assert.equal(
    (await costRepository.getByGenerationId(preview.generationId)).status,
    "discarded"
  );

  const preview2 = await generationService.preview({
    idea: "b",
    category: "Wisdom Wednesday",
    stream: "orok-morning",
    discardGenerationId: preview.generationId,
  });
  await generationService.generateDraft({
    stream: "orok-morning",
    plannedDate: "2026-07-16",
    idea: "b",
    category: "Wisdom Wednesday",
    text: preview2.candidates[1],
    generationId: preview2.generationId,
  });
  assert.equal(
    (await costRepository.getByGenerationId(preview2.generationId)).status,
    "accepted"
  );
});

test("failed generation creates failed ledger record without inventing tokens", async () => {
  const { generationService, costRepository, postGenerator } = await freshGen({
    postGenerator: new StubPostGenerator({ fail: new Error("boom") }),
  });
  await assert.rejects(
    () =>
      generationService.preview({
        idea: "x",
        category: "Motivation Monday",
        stream: "orok-morning",
      }),
    /boom/
  );
  assert.equal(postGenerator.calls, 1);
  const recent = await costRepository.listRecent();
  assert.equal(recent.length, 1);
  assert.equal(recent[0].status, "failed");
  assert.equal(recent[0].inputTokens, null);
  assert.equal(recent[0].outputTokens, null);
  assert.equal(recent[0].estimatedCostUsd, null);
});

test("ledger persistence failure does not trigger a second OpenAI request", async () => {
  const failingRepo = {
    async init() {},
    async close() {},
    getStorageType() {
      return "memory";
    },
    async create() {
      throw new Error("disk full");
    },
    async getByGenerationId() {
      return null;
    },
    async attachPublishingItem() {
      throw new Error("disk full");
    },
    async markAccepted() {
      throw new Error("disk full");
    },
    async markDiscarded() {
      throw new Error("disk full");
    },
    async markFailed() {
      throw new Error("disk full");
    },
    async listRecent() {
      return [];
    },
    async aggregateSummary() {
      return buildSummary([]);
    },
  };
  const { generationService, postGenerator, logs } = await freshGen({
    costRepository: failingRepo,
  });
  const preview = await generationService.preview({
    idea: "x",
    category: "Motivation Monday",
    stream: "orok-morning",
  });
  assert.equal(postGenerator.calls, 1);
  assert.equal(preview.candidates.length, 3);
  assert.equal(preview.costTrackingUnavailable, true);
  assert.ok(preview.usage);
  assert.ok(logs.some((l) => /COST_LEDGER_WARNING/.test(l.msg)));
});

test("summary aggregation, date-range, stream and model totals", async () => {
  const repo = new InMemoryCostLedgerRepository();
  const r1 = createUsageRecord({
    stream: "orok-morning",
    category: "Motivation Monday",
    model: "gpt-4.1-mini",
    inputTokens: 1000,
    outputTokens: 500,
    status: "accepted",
    createdAt: "2026-07-16T10:00:00.000Z",
    updatedAt: "2026-07-16T10:00:00.000Z",
  });
  const r2 = createUsageRecord({
    stream: "coffee-break-build",
    category: "Friday Freestyle",
    model: "gpt-4.1-mini",
    inputTokens: 2000,
    outputTokens: 800,
    status: "discarded",
    createdAt: "2026-07-15T10:00:00.000Z",
    updatedAt: "2026-07-15T10:00:00.000Z",
  });
  const r3 = createUsageRecord({
    stream: "orok-morning",
    category: "Wisdom Wednesday",
    model: "gpt-4o-mini",
    inputTokens: 500,
    outputTokens: 200,
    status: "failed",
    createdAt: "2026-07-16T12:00:00.000Z",
    updatedAt: "2026-07-16T12:00:00.000Z",
  });
  await repo.create(r1);
  await repo.create(r2);
  await repo.create(r3);

  const day = await repo.aggregateSummary({
    from: "2026-07-16",
    to: "2026-07-16",
  });
  assert.equal(day.totalGenerations, 2);
  assert.equal(day.totalAccepted, 1);
  assert.equal(day.totalFailed, 1);
  assert.equal(day.totalDiscarded, 0);
  assert.ok(day.byStream["orok-morning"]);
  assert.ok(day.byModel["gpt-4.1-mini"]);
  assert.ok(typeof day.averageCostPerAcceptedPostUsd === "number");

  const filtered = filterByDateRange([r1, r2, r3], {
    from: "2026-07-16",
    to: "2026-07-16",
  });
  assert.equal(filtered.length, 2);
});

test("migration 004 is loaded and pending until applied", () => {
  const all = loadMigrations();
  const names = all.map((m) => m.name);
  assert.ok(names.includes("004_publishing_generation_costs.sql"));
  const pending = computePending(names, [
    "001_create_publishing_items.sql",
    "002_publishing_items_indexes.sql",
    "003_publishing_topic_search.sql",
  ]);
  assert.deepEqual(pending, ["004_publishing_generation_costs.sql"]);
  const sql = all.find((m) => m.name === "004_publishing_generation_costs.sql").sql;
  assert.match(sql, /publishing_generation_costs/);
  assert.match(sql, /generation_id/);
  assert.match(sql, /estimated_cost_usd/);
});

test("HTTP preview includes generationId + usage; costs summary endpoint works", async () => {
  const publishing = createPublishing({
    repository: new InMemoryPublishingRepository(),
    postGenerator: new StubPostGenerator(),
    mode: "memory",
  });
  await publishing.ready;
  const app = express();
  app.use(express.json());
  app.use("/api/publishing", publishing.router);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = "http://127.0.0.1:" + server.address().port;
  try {
    const preview = await fetch(base + "/api/publishing/generate/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        idea: "cost http",
        category: "Motivation Monday",
        stream: "orok-morning",
      }),
    });
    assert.equal(preview.status, 200);
    const body = await preview.json();
    assert.ok(body.generationId);
    assert.ok(body.usage);
    assert.equal(typeof body.usage.estimatedCostUsd, "number");

    const create = await fetch(base + "/api/publishing/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        stream: "orok-morning",
        plannedDate: "2026-07-16",
        topic: "cost http",
        category: "Motivation Monday",
        text: body.candidates[0],
        generationId: body.generationId,
      }),
    });
    assert.equal(create.status, 201);
    const created = await create.json();
    assert.equal(created.item.status, "review");
    assert.equal(created.generationRequestPerformed, false);

    const summary = await fetch(base + "/api/publishing/costs/summary");
    assert.equal(summary.status, 200);
    const s = await summary.json();
    assert.equal(s.totalGenerations, 1);
    assert.equal(s.totalAccepted, 1);

    const recent = await fetch(base + "/api/publishing/costs/recent?limit=5");
    assert.equal(recent.status, 200);
    const r = await recent.json();
    assert.equal(r.count, 1);
    assert.equal(r.records[0].status, "accepted");
  } finally {
    await new Promise((r) => server.close(r));
    await publishing.close();
  }
});
