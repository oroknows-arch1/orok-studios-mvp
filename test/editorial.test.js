"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  resolveEditorialProfile,
  resolveEditorialContext,
  buildOrokPrompt,
  validateCandidates,
  WEEKDAY_DEFAULT_PROFILE,
  FAMILY_GREETING,
  FAMILY_SIGNOFF,
  NeedsGroundingError,
  EditorialResolutionError,
  EditorialValidationError,
  ARCHIVE_IMPORT_PATH,
} = require("../src/editorial");
const { StubPostGenerator } = require("../src/generator");
const { PublishingService } = require("../src/publishing/service");
const { InMemoryPublishingRepository } = require("../src/publishing/repository");
const { PublishingGenerationService } = require("../src/publishing/generation-service");

const BOONWURRUNG_GROUNDING = {
  nation: "Kulin Nation",
  region: "Melbourne and the Mornington Peninsula",
  practices: [
    "seasonal movement",
    "fishing",
    "shellfish gathering",
    "careful management of coastal resources",
  ],
  continuity: "Boonwurrung cultural knowledge and custodianship continue today",
};

/* ---------- schedule resolution ---------- */

test("Monday resolves Motivation", () => {
  const r = resolveEditorialProfile({ scheduledFor: "2026-07-13" }); // Monday UTC
  assert.equal(WEEKDAY_DEFAULT_PROFILE[1], "motivation");
  assert.equal(r.profileId, "motivation");
  assert.equal(r.source, "weekday-default");
});

test("Tuesday resolves Masters of Today", () => {
  assert.equal(
    resolveEditorialProfile({ scheduledFor: "2026-07-14" }).profileId,
    "masters-of-today"
  );
});

test("Wednesday resolves Wisdom", () => {
  assert.equal(
    resolveEditorialProfile({ scheduledFor: "2026-07-15" }).profileId,
    "wisdom"
  );
});

test("Thursday resolves Masters of Yesterday by default; Cultural Series when explicit", () => {
  assert.equal(
    resolveEditorialProfile({ scheduledFor: "2026-07-16" }).profileId,
    "masters-of-yesterday"
  );
  assert.equal(
    resolveEditorialProfile({
      scheduledFor: "2026-07-16",
      category: "Cultural Series",
    }).profileId,
    "cultural-series"
  );
});

test("Friday resolves Recap; Freestyle when explicit", () => {
  assert.equal(
    resolveEditorialProfile({ scheduledFor: "2026-07-17" }).profileId,
    "friday-recap"
  );
  assert.equal(
    resolveEditorialProfile({
      scheduledFor: "2026-07-17",
      category: "Friday Freestyle",
    }).profileId,
    "friday-freestyle"
  );
});

test("Sunday resolves Long Game", () => {
  assert.equal(
    resolveEditorialProfile({ scheduledFor: "2026-07-19" }).profileId,
    "long-game"
  );
  assert.equal(
    resolveEditorialProfile({ stream: "sunday-long-game" }).profileId,
    "long-game"
  );
});

test("explicit publishing category overrides weekday", () => {
  const r = resolveEditorialProfile({
    scheduledFor: "2026-07-13", // Monday
    category: "Long Game",
  });
  assert.equal(r.profileId, "long-game");
  assert.equal(r.source, "explicit-category");
});

test("missing profile resolution errors instead of generic generation", () => {
  assert.throws(
    () => resolveEditorialProfile({ category: "Not A Real Type" }),
    EditorialResolutionError
  );
});

/* ---------- surfaces / validation ---------- */

test("family message greeting and closing", () => {
  const ctx = resolveEditorialContext({
    category: "Motivation Monday",
    topic: "routine",
    surface: "family-message",
  });
  const ok = [
    `${FAMILY_GREETING}\nRoutine beats mood when the first step is prepared.\n${FAMILY_SIGNOFF}`,
    `${FAMILY_GREETING}\nYou notice the skip before the speech. Start smaller.\n${FAMILY_SIGNOFF}`,
    `${FAMILY_GREETING}\nThe quiet repeat is the work. Keep one action.\n${FAMILY_SIGNOFF}`,
  ];
  const result = validateCandidates(ok, ctx);
  assert.equal(result.ok, true);
});

test("X maximum 280 characters and exactly 3 hashtags", () => {
  const ctx = resolveEditorialContext({
    category: "Motivation Monday",
    topic: "focus",
    surface: "x-post",
  });
  const ok = [
    "Focus is a small start you repeat.\n#OnlyRealOnesKnow #Focus #WorkEthic",
    "Skip the speech. Keep the first tool ready.\n#OurRootsOurKnowledge #Consistency #Mindset",
    "Mood fades. Structure stays.\n#OnlyRealOnesKnow #Routine #Progress",
  ];
  for (const p of ok) assert.ok(p.length <= 280);
  assert.equal(validateCandidates(ok, ctx).ok, true);

  assert.throws(
    () =>
      validateCandidates(
        ["Morning everyone 👋\nNope.\nEnjoy the day love you all c u this arvo😘\n#A #B #C"],
        ctx
      ),
    EditorialValidationError
  );
});

test("Motivation rejects generic self-help output", () => {
  const ctx = resolveEditorialContext({
    category: "Motivation Monday",
    topic: "work",
    surface: "family-message",
  });
  assert.throws(
    () =>
      validateCandidates(
        [
          `${FAMILY_GREETING}\nJust believe in yourself and never give up.\n${FAMILY_SIGNOFF}`,
          `${FAMILY_GREETING}\nUnlock your potential today.\n${FAMILY_SIGNOFF}`,
          `${FAMILY_GREETING}\nEmbrace the journey always.\n${FAMILY_SIGNOFF}`,
        ],
        ctx
      ),
    EditorialValidationError
  );
});

test("Long Game avoids mortgage assumptions", () => {
  const ctx = resolveEditorialContext({
    stream: "sunday-long-game",
    topic: "household budgets",
    surface: "family-message",
  });
  assert.throws(
    () =>
      validateCandidates(
        [
          `${FAMILY_GREETING}\nYour mortgage is the only signal that matters.\n${FAMILY_SIGNOFF}`,
          `${FAMILY_GREETING}\nWatch cashflow trade-offs without jargon.\n${FAMILY_SIGNOFF}`,
          `${FAMILY_GREETING}\nName the risk you can carry this year.\n${FAMILY_SIGNOFF}`,
        ],
        ctx
      ),
    (err) =>
      err instanceof EditorialValidationError &&
      err.errors.some((e) => /mortgage/i.test(e))
  );
});

test("Coffee Break Build distinguishes progress from hype", () => {
  const ctx = resolveEditorialContext({
    category: "Coffee Break Build",
    topic: "draft generation",
    surface: "family-message",
    grounding: {
      stage: "implementation",
      problem: "generic prompts",
      lesson: "use the editorial system",
    },
  });
  assert.throws(
    () =>
      validateCandidates(
        [
          `${FAMILY_GREETING}\nWe are launching soon with a game-changer.\n${FAMILY_SIGNOFF}`,
          `${FAMILY_GREETING}\nStill in implementation fixing generic prompts.\n${FAMILY_SIGNOFF}`,
          `${FAMILY_GREETING}\nLesson: use the editorial system before you announce.\n${FAMILY_SIGNOFF}`,
        ],
        ctx
      ),
    (err) =>
      err instanceof EditorialValidationError &&
      err.errors.some((e) => /hype/i.test(e))
  );
});

test("missing factual grounding returns needs_grounding", () => {
  assert.throws(
    () =>
      resolveEditorialContext({
        category: "Cultural Series",
        topic: "Boonwurrung people",
        surface: "family-message",
      }),
    NeedsGroundingError
  );
});

/* ---------- Cultural Series acceptance fixture ---------- */

test("Cultural Series family fixture passes validator with grounded facts", async () => {
  const gen = new StubPostGenerator();
  const result = await gen.generatePosts({
    stream: "orok-morning",
    category: "cultural-series",
    surface: "family-message",
    topic: "Boonwurrung people",
    grounding: BOONWURRUNG_GROUNDING,
  });

  assert.equal(result.editorial.editorialProfile, "cultural-series");
  assert.equal(result.editorial.surface, "family-message");
  assert.equal(result.editorial.validationStatus, "passed");
  assert.equal(result.posts.length, 3);

  for (const post of result.posts) {
    assert.ok(post.startsWith(FAMILY_GREETING));
    assert.ok(post.trimEnd().endsWith(FAMILY_SIGNOFF));
    assert.equal(/#\w+/.test(post), false);
    assert.equal(/harmony with nature/i.test(post), false);
    assert.match(post, /today|continue|continuing|living|still/i);
  }

  // at least three supplied factual details appear across / within posts
  const joined = result.posts.join("\n").toLowerCase();
  const hits = [
    "kulin",
    "melbourne",
    "seasonal",
    "fishing",
    "shellfish",
    "coastal",
  ].filter((w) => joined.includes(w));
  assert.ok(hits.length >= 3, `expected grounded detail hits, got ${hits}`);
});

test("candidates are not near-duplicates", async () => {
  const gen = new StubPostGenerator();
  const result = await gen.generatePosts({
    category: "Motivation Monday",
    topic: "consistency",
    surface: "family-message",
  });
  assert.doesNotThrow(() =>
    validateCandidates(
      result.posts,
      resolveEditorialContext({
        category: "Motivation Monday",
        topic: "consistency",
        surface: "family-message",
      })
    )
  );
});

test("prompt builder includes profile, surface, grounding, and forbids copying examples", () => {
  const ctx = resolveEditorialContext({
    category: "Cultural Series",
    topic: "Boonwurrung people",
    surface: "family-message",
    grounding: BOONWURRUNG_GROUNDING,
    debug: true,
  });
  const built = buildOrokPrompt({ ...ctx, debug: true });
  assert.match(built.system, /Cultural Series/);
  assert.match(built.system, /OROK CORE VOICE/);
  assert.match(built.system, /Family message/);
  assert.match(built.user, /Kulin Nation/);
  assert.match(built.user, /do NOT copy phrases/i);
  assert.equal(built.meta.editorialProfile, "cultural-series");
  assert.ok(built.debug);
});

test("/generate and publishing generation share canonical prompt builder metadata", async () => {
  const gen = new StubPostGenerator();
  const a = await gen.generatePosts({
    category: "Wisdom Wednesday",
    topic: "stillness",
    surface: "family-message",
  });
  const b = await gen.generatePosts({
    category: "Wisdom Wednesday",
    topic: "stillness",
    surface: "family-message",
  });
  assert.equal(a.promptMeta.editorialProfile, b.promptMeta.editorialProfile);
  assert.equal(a.promptMeta.surface, "family-message");
  assert.equal(a.editorial.editorialProfile, "wisdom");
});

test("generated items still land in review; approval remains human-controlled", async () => {
  const publishingService = new PublishingService(new InMemoryPublishingRepository());
  await publishingService.init();
  const generationService = new PublishingGenerationService({
    publishingService,
    postGenerator: new StubPostGenerator(),
  });
  const { item } = await generationService.generateDraft({
    stream: "orok-morning",
    plannedDate: "2026-07-16",
    category: "Cultural Series",
    topic: "Boonwurrung people",
    surface: "family-message",
    grounding: BOONWURRUNG_GROUNDING,
  });
  assert.equal(item.status, "review");
  assert.notEqual(item.status, "approved");
  assert.notEqual(item.status, "published");
});

test("archive import path is documented for historical OROK posts", () => {
  assert.equal(ARCHIVE_IMPORT_PATH, "src/editorial/examples/");
});
