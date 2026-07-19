"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  COUNTRY_STREAMS,
  ANCHOR_THURSDAY,
  resolveCountryForThursday,
  thursdayIndexFromAnchor,
  scheduledThursdayDate,
  composeMastersOfYesterdayPost,
  assertCanonicalShape,
  GREETING,
  SIGNOFF,
  buildHeritageLensBrief,
  selectCulturalEntry,
  selectEpisode,
  resetCatalogueForTests,
  listApprovedByCountry,
  MastersOfYesterdayEngine,
  morningForWeekday,
  generatorCategoryFor,
} = Object.assign(
  {},
  require("../src/publishing/masters-of-yesterday"),
  require("../src/publishing/schedule/weekly")
);

const { PublishingService } = require("../src/publishing/service");
const { InMemoryPublishingRepository } = require("../src/publishing/repository");
const { DraftPreparationService } = require("../src/publishing/schedule");
const { LongGameEngine } = require("../src/publishing/long-game");

test("weekly calendar wires every day to the correct category + generator", () => {
  const expected = {
    1: { label: "Motivation Monday", gen: "Motivation Monday" },
    2: { label: "Masters of Today", gen: "Masters of Today" },
    3: { label: "Words of Wisdom", gen: "Wisdom Wednesday" },
    4: { label: "Masters of Yesterday", gen: "Masters of Yesterday" },
    5: { label: "Weekly Reflection", gen: "Friday Recap" },
    6: { label: "Saturday Mixed", gen: "Friday Freestyle" },
    7: { label: "The Long Game", gen: "Sunday Long Game" },
  };
  for (const [day, exp] of Object.entries(expected)) {
    const plan = morningForWeekday(Number(day));
    assert.equal(plan.label, exp.label, "weekday " + day);
    assert.equal(generatorCategoryFor(plan.label), exp.gen);
  }
  assert.equal(morningForWeekday(4).culturalSeries, true);
  assert.equal(morningForWeekday(4).includeCookIslandsMaori, true);
  assert.equal(morningForWeekday(2).tributeManualImage, true);
});

test("rotation order is Australia → Cook Islands → Aotearoa → Peru and repeats", () => {
  // Anchor 2026-01-01 is Thursday → index 0 → Indigenous Australia
  assert.equal(ANCHOR_THURSDAY, "2026-01-01");
  const a = resolveCountryForThursday("2026-01-01");
  assert.equal(a.countryStream.id, "indigenous-australia");
  assert.equal(a.rotationIndex, 0);

  const b = resolveCountryForThursday("2026-01-08");
  assert.equal(b.countryStream.id, "cook-islands");
  assert.equal(b.rotationIndex, 1);

  const c = resolveCountryForThursday("2026-01-15");
  assert.equal(c.countryStream.id, "aotearoa-new-zealand");

  const d = resolveCountryForThursday("2026-01-22");
  assert.equal(d.countryStream.id, "peru");

  const e = resolveCountryForThursday("2026-01-29");
  assert.equal(e.countryStream.id, "indigenous-australia");
  assert.deepEqual(
    COUNTRY_STREAMS.map((s) => s.id),
    [
      "indigenous-australia",
      "cook-islands",
      "aotearoa-new-zealand",
      "peru",
    ]
  );
});

test("missed Thursday does not change calendar sequence", () => {
  // Skip publishing on 2026-01-08 — next Thursday still Cook Islands was previous;
  // 2026-01-15 must still be Aotearoa (index 2), not delayed.
  const mid = resolveCountryForThursday("2026-01-15");
  assert.equal(mid.rotationIndex, 2);
  assert.equal(thursdayIndexFromAnchor("2026-01-15"), 2);
});

test("rotation is deterministic across process restart (pure calendar)", () => {
  const first = resolveCountryForThursday("2026-07-16"); // Thursday
  const second = resolveCountryForThursday("2026-07-16");
  assert.deepEqual(first.countryStream.id, second.countryStream.id);
  assert.equal(first.rotationIndex, second.rotationIndex);
});

test("canonical editorial style preserves greeting, signoff, exactly 3 hashtags", () => {
  const entry = listApprovedByCountry("indigenous-australia")[0];
  const country = COUNTRY_STREAMS[0];
  const post = composeMastersOfYesterdayPost(entry, country);
  assert.ok(post.familyText.startsWith(GREETING));
  assert.ok(post.familyText.includes(SIGNOFF));
  assert.equal(assertCanonicalShape(post.familyText).length, 0);
  assert.equal(post.hashtags.length, 3);
  assert.ok(!/did you know/i.test(post.familyText));
  assert.ok(post.xText.includes(GREETING));
});

test("Heritage Lens brief prohibits mixed-culture generic imagery", () => {
  const entry = listApprovedByCountry("peru").find((e) => e.id === "pe-achuar");
  const brief = buildHeritageLensBrief(entry, COUNTRY_STREAMS[3]);
  assert.equal(brief.imageLens, "Heritage Lens");
  assert.match(brief.imageBrief, /HERITAGE LENS/);
  assert.match(brief.imageBrief, /mixing cultures/i);
  assert.match(brief.imageBrief, /fake ceremonies/i);
  assert.ok(brief.imageCompositionSignature);
});

test("cultural subjects do not repeat before catalogue exhaustion; LRU after", () => {
  const country = "cook-islands";
  const approved = listApprovedByCountry(country);
  const history = [];
  const seen = [];
  for (let i = 0; i < approved.length; i++) {
    const pick = selectCulturalEntry(country, history);
    assert.ok(pick);
    assert.ok(!seen.includes(pick.subject), "premature repeat " + pick.subject);
    seen.push(pick.subject);
    history.push({
      seriesMeta: {
        countryStream: country,
        culturalSubject: pick.subject,
        scheduledDate: `2026-0${(i % 9) + 1}-0${(i % 2) + 1}`,
      },
    });
  }
  assert.equal(seen.length, approved.length);
  const after = selectCulturalEntry(country, history);
  assert.ok(after);
  // LRU should return one of the approved subjects
  assert.ok(approved.some((a) => a.subject === after.subject));
});

test("podcast selection returns episode-specific Apple URL and avoids repeats", () => {
  resetCatalogueForTests();
  const used = [];
  const first = selectEpisode({ usedEpisodeIds: used, cycleKey: "t1" });
  assert.equal(first.ok, true);
  assert.match(first.thursdayLingo.applePodcastsUrl, /podcasts\.apple\.com/);
  assert.match(first.thursdayLingo.applePodcastsUrl, /[?&]i=\d+/);
  used.push(first.thursdayLingo.episodeId);
  const second = selectEpisode({ usedEpisodeIds: used, cycleKey: "t1" });
  assert.notEqual(second.thursdayLingo.episodeId, first.thursdayLingo.episodeId);
});

async function makeStack() {
  const repo = new InMemoryPublishingRepository();
  const svc = new PublishingService(repo);
  await svc.init();
  const moy = new MastersOfYesterdayEngine({ publishingService: svc });
  const longGame = new LongGameEngine({ publishingService: svc });
  const preparation = new DraftPreparationService({
    publishingService: svc,
    longGameEngine: longGame,
    moyEngine: moy,
    timeZone: "UTC",
  });
  return { svc, moy, preparation };
}

test("Thursday preparation creates MoY draft with country, Heritage Lens, and Thursday Lingo", async () => {
  const { svc, preparation } = await makeStack();
  // Thursday 2026-07-16 05:30 UTC
  const now = new Date("2026-07-16T05:30:00.000Z");
  const result = await preparation.prepare({ now, force: true, kinds: ["morning"] });
  assert.ok(result.results.some((r) => r.kind === "masters-of-yesterday"));
  const items = await svc.listItems({ date: "2026-07-16", stream: "orok-morning" });
  const moy = items.find((i) => i.category === "Masters of Yesterday");
  assert.ok(moy);
  assert.ok(moy.seriesMeta);
  assert.ok(moy.seriesMeta.countryStream);
  assert.ok(moy.seriesMeta.culturalSubject);
  assert.ok(moy.seriesMeta.subjectType);
  assert.equal(moy.seriesMeta.imageLens, "Heritage Lens");
  assert.match(moy.imageBrief, /HERITAGE LENS/);
  assert.ok(moy.seriesMeta.thursdayLingo);
  assert.match(moy.text, /Thursday Lingo/);
  assert.match(moy.text, /Morning everyone/);
  if (moy.seriesMeta.thursdayLingo.applePodcastsUrl) {
    assert.match(moy.seriesMeta.thursdayLingo.applePodcastsUrl, /[?&]i=\d+/);
  }
});

test("duplicate Thursday preparation is idempotent (same draft, same episode)", async () => {
  const { svc, moy } = await makeStack();
  const a = await moy.generateAndStore({ scheduledDate: "2026-07-16" });
  const b = await moy.generateAndStore({ scheduledDate: "2026-07-16" });
  assert.equal(a.action, "created");
  assert.equal(b.action, "exists");
  assert.equal(a.item.id, b.item.id);
  assert.equal(
    a.item.seriesMeta.thursdayLingo.episodeId,
    b.item.seriesMeta.thursdayLingo.episodeId
  );
  const all = await svc.listItems({ category: "Masters of Yesterday" });
  assert.equal(all.filter((i) => i.plannedDate === "2026-07-16").length, 1);
});

test("only one country assigned per Thursday draft", async () => {
  const { moy } = await makeStack();
  const { item } = await moy.generateAndStore({ scheduledDate: "2026-01-08" });
  assert.equal(item.seriesMeta.countryStream, "cook-islands");
  assert.equal(item.seriesMeta.rotationIndex, 1);
  assert.ok(!/,.*,/.test(item.seriesMeta.countryStream));
});

test("subject types remain distinct across catalogue", () => {
  const types = new Set(
    require("../src/publishing/masters-of-yesterday/catalogue").CULTURAL_CATALOGUE.map(
      (e) => e.subjectType
    )
  );
  assert.ok(types.has("Indigenous nation"));
  assert.ok(types.has("iwi"));
  assert.ok(types.has("island community"));
  assert.ok(types.has("civilisation"));
  assert.ok(types.has("waka tradition"));
  assert.ok(types.has("people"));
});

test("scheduledThursdayDate uses local Thursday", () => {
  const d = scheduledThursdayDate(new Date("2026-07-16T05:00:00.000Z"), {
    timeZone: "UTC",
    prefer: "today",
  });
  assert.equal(d, "2026-07-16");
});
