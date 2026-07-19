"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  LongGameEngine,
  listCategories,
  registerCategory,
  resetCategories,
  DEFAULT_WEEKLY_CATEGORIES,
  MIN_SOURCES,
  MAX_SOURCES,
  isValidHttpUrl,
  assertLongGameSources,
  selectSources,
  formatSourcesFooter,
  streamAllowsSources,
  postLabelAllowsSources,
  SOURCE_FREE_POST_LABELS,
  formatLongGamePost,
  formatLongGameXPost,
  textHasSourcesFooter,
  runIntelligence,
  collectDevelopments,
} = require("../src/publishing/long-game");
const { SourceValidationError } = require("../src/publishing/long-game/sources");
const { PublishingService } = require("../src/publishing/service");
const { InMemoryPublishingRepository } = require("../src/publishing/repository");
const { collectItemErrors, ValidationError } = require("../src/publishing/validation");
const { createItem } = require("../src/publishing/model");

const SAMPLE_DEVELOPMENTS = [
  {
    headline: "RBA holds cash rate steady amid sticky services inflation",
    summary: "Board leaves rates unchanged while watching household costs.",
    category: "Australian Economy",
    sources: [
      {
        title: "RBA Monetary Policy Decision",
        url: "https://www.rba.gov.au/media-releases/2026/mr-26-01.html",
        publisher: "Reserve Bank of Australia",
        publicationDate: "2026-07-01",
      },
    ],
  },
  {
    headline: "ABS reports softer retail turnover for June",
    category: "Cost of Living",
    sources: [
      {
        title: "Retail Trade, Australia",
        url: "https://www.abs.gov.au/statistics/industry/retail-and-wholesale-trade/retail-trade-australia/latest-release",
        publisher: "Australian Bureau of Statistics",
      },
    ],
  },
  {
    headline: "Get rich day-trading tips flood social media",
    category: "Markets",
  },
];

function sampleSources(n = 2) {
  const pool = [
    {
      title: "RBA Media Releases",
      url: "https://www.rba.gov.au/media-releases/",
      publisher: "Reserve Bank of Australia",
      accessDate: "2026-07-19",
    },
    {
      title: "ABS Media Releases",
      url: "https://www.abs.gov.au/media-centre/media-releases",
      publisher: "Australian Bureau of Statistics",
      accessDate: "2026-07-19",
    },
    {
      title: "Treasury News",
      url: "https://treasury.gov.au/news-media",
      publisher: "Treasury",
      accessDate: "2026-07-19",
    },
    {
      title: "ASIC News Centre",
      url: "https://asic.gov.au/about-asic/news-centre/",
      publisher: "ASIC",
      accessDate: "2026-07-19",
    },
    {
      title: "Australia.gov.au",
      url: "https://www.australia.gov.au/",
      publisher: "Australian Government",
      accessDate: "2026-07-19",
    },
  ];
  return pool.slice(0, n);
}

/* ---------- Categories ---------- */
test("weekly source categories include the required set and are extensible", () => {
  resetCategories();
  const cats = listCategories();
  for (const required of [
    "Australian Economy",
    "Global Economy",
    "Business",
    "Employment",
    "Artificial Intelligence",
    "Technology",
    "Markets",
    "Cost of Living",
    "Government Policy",
    "Energy",
    "Supply Chains",
    "Agriculture",
  ]) {
    assert.ok(cats.includes(required), "missing " + required);
  }
  assert.equal(cats.length, DEFAULT_WEEKLY_CATEGORIES.length);
  assert.equal(registerCategory("Climate Adaptation"), true);
  assert.ok(listCategories().includes("Climate Adaptation"));
  assert.equal(registerCategory("climate adaptation"), false);
  resetCategories();
});

/* ---------- Source validation ---------- */
test("isValidHttpUrl accepts only absolute http(s) links", () => {
  assert.equal(isValidHttpUrl("https://www.rba.gov.au/"), true);
  assert.equal(isValidHttpUrl("http://example.com/a"), true);
  assert.equal(isValidHttpUrl("ftp://example.com"), false);
  assert.equal(isValidHttpUrl("not-a-url"), false);
  assert.equal(isValidHttpUrl(""), false);
});

test("assertLongGameSources enforces 2–5 valid links", () => {
  assert.throws(() => assertLongGameSources([]), SourceValidationError);
  assert.throws(() => assertLongGameSources(sampleSources(1)), SourceValidationError);
  const two = assertLongGameSources(sampleSources(2));
  assert.equal(two.length, 2);
  const five = assertLongGameSources(sampleSources(5));
  assert.equal(five.length, 5);
  assert.throws(() => assertLongGameSources(sampleSources(5).concat(sampleSources(1))), SourceValidationError);
  assert.throws(
    () =>
      assertLongGameSources([
        { title: "A", url: "https://a.example/" },
        { title: "B", url: "not-valid" },
      ]),
    SourceValidationError
  );
});

test("selectSources caps at five and prefers primary publishers", () => {
  const mixed = [
    {
      title: "Opinion piece",
      url: "https://news.example/opinion",
      publisher: "Some Blog",
    },
    ...sampleSources(4),
    {
      title: "Extra",
      url: "https://extra.example/",
      publisher: "Wire",
    },
  ];
  const selected = selectSources(mixed);
  assert.ok(selected.length >= MIN_SOURCES && selected.length <= MAX_SOURCES);
  assert.ok(selected.every((s) => isValidHttpUrl(s.url)));
});

test("only Sunday Long Game may attach sources; other OROK posts stay source-free", () => {
  assert.equal(streamAllowsSources("sunday-long-game"), true);
  assert.equal(streamAllowsSources("orok-morning"), false);
  assert.equal(streamAllowsSources("coffee-break-build"), false);
  for (const label of SOURCE_FREE_POST_LABELS) {
    assert.equal(postLabelAllowsSources(label), false, label);
  }
  assert.equal(postLabelAllowsSources("Sunday Long Game"), true);
});

/* ---------- Post format ---------- */
test("Long Game post format includes title, body, lesson, macro signal, pattern, and Sources", () => {
  const sources = sampleSources(3);
  const text = formatLongGamePost({
    title: "The Long Game: Cost pressures",
    body: "Families are weighing everyday costs carefully.",
    familyLesson: "Review one recurring household expense this week.",
    macroSignal: "Softer retail turnover",
    dominantPattern: "Cost pressures are reshaping everyday family choices",
    sources,
  });
  assert.match(text, /^The Long Game:/);
  assert.match(text, /Practical family lesson:/);
  assert.match(text, /Macro Signal:/);
  assert.match(text, /Dominant Pattern:/);
  assert.match(text, /\nSources\n/);
  assert.ok(textHasSourcesFooter(text));
  const links = text.match(/\[[^\]]+\]\(https?:\/\/[^)]+\)/g) || [];
  assert.ok(links.length >= 2 && links.length <= 5);
});

test("X version also carries a Sources footer with clickable links", () => {
  const sources = sampleSources(2);
  const text = formatLongGameXPost({
    title: "The Long Game: Steady habits",
    body: "Short body.",
    familyLesson: "Keep a simple cash buffer goal visible.",
    macroSignal: "Rate hold",
    dominantPattern: "Interest-rate signals are steering longer-term money habits",
    sources,
  });
  assert.ok(textHasSourcesFooter(text));
  assert.match(text, /Family lesson:/);
});

/* ---------- Intelligence process ---------- */
test("intelligence process removes noise, finds pattern, and always emits 2–5 sources", () => {
  const result = runIntelligence({
    developments: SAMPLE_DEVELOPMENTS,
    accessDate: "2026-07-19",
  });
  assert.ok(result.noiseRemoved.some((n) => /get rich/i.test(n)));
  assert.ok(result.developments.length >= 2);
  assert.ok(result.dominantPattern);
  assert.ok(result.familyLesson);
  assert.ok(result.macroSignal);
  assert.ok(result.sources.length >= MIN_SOURCES);
  assert.ok(result.sources.length <= MAX_SOURCES);
  assert.ok(result.sources.every((s) => isValidHttpUrl(s.url)));
});

test("empty development week still produces a valid brief with primary sources", () => {
  const { developments, noiseRemoved } = collectDevelopments([]);
  assert.equal(developments.length, 0);
  assert.equal(noiseRemoved.length, 0);
  const brief = runIntelligence({ developments: [] });
  assert.ok(brief.sources.length >= 2);
  assert.ok(brief.title);
  assert.ok(brief.familyLesson);
});

/* ---------- Engine + ledger ---------- */
test("LongGameEngine generates family + X text and stores ledger metadata", async () => {
  const repo = new InMemoryPublishingRepository();
  const svc = new PublishingService(repo);
  await svc.init();
  const engine = new LongGameEngine({ publishingService: svc });

  const { brief, item } = await engine.generateAndStore(
    {
      developments: SAMPLE_DEVELOPMENTS,
      accessDate: "2026-07-19",
    },
    { plannedDate: "2026-07-19" }
  );

  assert.equal(item.stream, "sunday-long-game");
  assert.ok(item.macroSignal);
  assert.ok(item.dominantPattern);
  assert.ok(item.familyLesson);
  assert.ok(Array.isArray(item.sources));
  assert.ok(item.sources.length >= 2 && item.sources.length <= 5);
  assert.ok(item.sources.every((s) => s.title && isValidHttpUrl(s.url)));
  assert.ok(item.sources.every((s) => s.accessDate));
  assert.ok(textHasSourcesFooter(item.text));
  assert.ok(textHasSourcesFooter(brief.familyText));
  assert.ok(textHasSourcesFooter(brief.xText));

  // Historical edition retains source references after reload
  const loaded = await svc.getItem(item.id);
  assert.equal(loaded.sources.length, item.sources.length);
  assert.equal(loaded.sources[0].url, item.sources[0].url);
  assert.equal(loaded.macroSignal, item.macroSignal);
  assert.equal(loaded.dominantPattern, item.dominantPattern);
});

test("ledger is searchable by topic, pattern, publisher, year, and source", async () => {
  const repo = new InMemoryPublishingRepository();
  const svc = new PublishingService(repo);
  await svc.init();
  const engine = new LongGameEngine({ publishingService: svc });
  const { item } = await engine.generateAndStore(
    { developments: SAMPLE_DEVELOPMENTS, accessDate: "2026-07-19" },
    { plannedDate: "2026-07-19" }
  );

  const byPattern = await svc.listItems({ pattern: item.dominantPattern.slice(0, 12) });
  assert.ok(byPattern.some((i) => i.id === item.id));

  const publisher = item.sources[0].publisher;
  const byPublisher = await svc.listItems({ publisher });
  assert.ok(byPublisher.some((i) => i.id === item.id));

  const byYear = await svc.listItems({ year: "2026" });
  assert.ok(byYear.some((i) => i.id === item.id));

  const bySource = await svc.listItems({ source: "rba.gov.au" });
  assert.ok(bySource.some((i) => i.id === item.id));
});

test("other streams cannot store source links", async () => {
  const repo = new InMemoryPublishingRepository();
  const svc = new PublishingService(repo);
  await svc.init();
  await assert.rejects(
    () =>
      svc.createDraft({
        stream: "orok-morning",
        plannedDate: "2026-07-20",
        topic: "Motivation",
        text: "Show up.",
        sources: sampleSources(2),
      }),
    ValidationError
  );
  await assert.rejects(
    () =>
      svc.createDraft({
        stream: "coffee-break-build",
        plannedDate: "2026-07-20",
        topic: "Build",
        text: "Ship something small.",
        sources: sampleSources(2),
      }),
    ValidationError
  );
});

test("published Sunday Long Game requires 2–5 sources; draft without sources is allowed until publish", async () => {
  const draft = createItem({
    stream: "sunday-long-game",
    plannedDate: "2026-07-19",
    topic: "Quiet week",
    text: "body",
    status: "draft",
    sources: [],
  });
  assert.deepEqual(collectItemErrors(draft), []);

  const publishedBare = createItem({
    stream: "sunday-long-game",
    plannedDate: "2026-07-19",
    topic: "Quiet week",
    text: "body",
    status: "published",
    publishedAt: "2026-07-19T00:00:00.000Z",
    sources: [],
  });
  const errors = collectItemErrors(publishedBare);
  assert.ok(errors.some((e) => /source/i.test(e)));

  const publishedOk = createItem({
    stream: "sunday-long-game",
    plannedDate: "2026-07-19",
    topic: "Quiet week",
    text: formatLongGamePost({
      title: "The Long Game: Quiet week",
      body: "Calm focus.",
      familyLesson: "Protect a quiet weekly check-in.",
      macroSignal: "Quiet week",
      dominantPattern: "Steady household focus amid a quiet news week",
      sources: sampleSources(2),
    }),
    status: "published",
    publishedAt: "2026-07-19T00:00:00.000Z",
    macroSignal: "Quiet week",
    dominantPattern: "Steady household focus amid a quiet news week",
    familyLesson: "Protect a quiet weekly check-in.",
    sources: sampleSources(2),
  });
  assert.deepEqual(collectItemErrors(publishedOk), []);
});

test("formatSourcesFooter always renders clickable markdown links", () => {
  const footer = formatSourcesFooter(sampleSources(2));
  assert.match(footer, /^Sources\n/);
  assert.match(footer, /\[.+\]\(https:\/\/www\.rba\.gov\.au/);
  assert.match(footer, /\[.+\]\(https:\/\/www\.abs\.gov\.au/);
});
