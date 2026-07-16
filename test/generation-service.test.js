"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { PublishingService, SEED_CBB_001_ID } = require("../src/publishing/service");
const { InMemoryPublishingRepository } = require("../src/publishing/repository");
const {
  PublishingGenerationService,
  GenerationUnavailableError,
} = require("../src/publishing/generation-service");
const { StubPostGenerator } = require("../src/generator");
const { ValidationError } = require("../src/publishing/validation");

async function fresh() {
  const publishingService = new PublishingService(new InMemoryPublishingRepository());
  await publishingService.init();
  const postGenerator = new StubPostGenerator();
  const generationService = new PublishingGenerationService({
    publishingService,
    postGenerator,
  });
  return { publishingService, generationService, postGenerator };
}

test("preview returns candidates without persisting", async () => {
  const { publishingService, generationService } = await fresh();
  const before = (await publishingService.listItems()).length;
  const result = await generationService.preview({
    idea: "consistency",
    category: "Motivation Monday",
    surface: "family-message",
  });
  assert.ok(Array.isArray(result.candidates));
  assert.equal(result.candidates.length, 3);
  assert.equal(result.editorialProfile, "motivation");
  assert.equal(result.surface, "family-message");
  assert.equal((await publishingService.listItems()).length, before);
});

test("generateDraft creates a draft and places it in review by default", async () => {
  const { generationService, publishingService } = await fresh();
  const { item, candidates, selectedIndex, duplicateAdvisory } =
    await generationService.generateDraft({
      stream: "orok-morning",
      plannedDate: "2026-07-16",
      idea: "consistency under pressure",
      category: "Motivation Monday",
    });

  assert.equal(item.status, "review");
  assert.equal(item.stream, "orok-morning");
  assert.equal(item.topic, "consistency under pressure");
  assert.equal(item.category, "Motivation Monday");
  assert.match(item.text, /Morning everyone/);
  assert.ok(Array.isArray(candidates));
  assert.equal(selectedIndex, 0);
  assert.ok(duplicateAdvisory);

  const stored = await publishingService.getItem(item.id);
  assert.equal(stored.status, "review");
});

test("generateDraft never auto-approves or publishes", async () => {
  const { generationService } = await fresh();
  const { item } = await generationService.generateDraft({
    stream: "orok-morning",
    plannedDate: "2026-07-16",
    idea: "stillness",
    category: "Wisdom Wednesday",
  });
  assert.notEqual(item.status, "approved");
  assert.notEqual(item.status, "published");
  assert.ok(["draft", "review"].includes(item.status));
});

test("placeInReview:false leaves the item as draft", async () => {
  const { generationService } = await fresh();
  const { item } = await generationService.generateDraft({
    stream: "orok-morning",
    plannedDate: "2026-07-16",
    idea: "reflection",
    category: "Wisdom Wednesday",
    placeInReview: false,
  });
  assert.equal(item.status, "draft");
});

test("selectedIndex chooses among candidates", async () => {
  const { generationService } = await fresh();
  const { item, selectedIndex, candidates } = await generationService.generateDraft({
    stream: "saturday-mixed",
    plannedDate: "2026-07-18",
    idea: "friday energy",
    category: "Friday Freestyle",
    selectedIndex: 2,
  });
  assert.equal(selectedIndex, 2);
  assert.equal(item.text, candidates[2]);
});

test("accepting pre-selected text skips the generator", async () => {
  let called = 0;
  const publishingService = new PublishingService(new InMemoryPublishingRepository());
  await publishingService.init();
  const generationService = new PublishingGenerationService({
    publishingService,
    postGenerator: new StubPostGenerator(() => {
      called += 1;
      return { posts: ["should not be used"] };
    }),
  });

  const { item, candidates } = await generationService.generateDraft({
    stream: "orok-morning",
    plannedDate: "2026-07-16",
    topic: "chosen manually",
    category: "Motivation Monday",
    text: "Morning everyone 👋\nChosen candidate.\nEnjoy the day love you all c u this arvo😘\n#OnlyRealOnesKnow #Focus #RealTalk",
  });

  assert.equal(called, 0);
  assert.equal(candidates, null);
  assert.equal(item.status, "review");
  assert.match(item.text, /Chosen candidate/);
});

test("Coffee Break Build generation reserves the next number", async () => {
  const { generationService, publishingService } = await fresh();
  const { item } = await generationService.generateDraft({
    stream: "coffee-break-build",
    plannedDate: "2026-07-16",
    idea: "build #002",
    category: "Coffee Break Build",
    grounding: {
      stage: "implementation",
      problem: "editorial wiring",
      lesson: "resolve profile before generate",
    },
  });
  assert.equal(item.seriesNumber, 2);
  assert.equal(item.status, "review");
  // seed #001 untouched
  const seed = await publishingService.getItem(SEED_CBB_001_ID);
  assert.equal(seed.status, "published");
  assert.equal(seed.seriesNumber, 1);
});

test("validation rejects unknown category and missing stream", async () => {
  const { generationService } = await fresh();
  await assert.rejects(
    () =>
      generationService.preview({
        idea: "x",
        category: "Not A Real Category",
      }),
    ValidationError
  );
  await assert.rejects(
    () =>
      generationService.generateDraft({
        plannedDate: "2026-07-16",
        idea: "x",
        category: "Motivation Monday",
      }),
    ValidationError
  );
});

test("missing postGenerator yields GenerationUnavailableError", async () => {
  const publishingService = new PublishingService(new InMemoryPublishingRepository());
  await publishingService.init();
  const generationService = new PublishingGenerationService({ publishingService });
  assert.equal(generationService.isAvailable(), false);
  await assert.rejects(
    () => generationService.preview({ idea: "x", category: "Motivation Monday" }),
    GenerationUnavailableError
  );
});
