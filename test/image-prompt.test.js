"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

/**
 * Load the live buildImagePrompt from app.js without executing UI bootstrap.
 */
function loadBuildImagePrompt() {
  const src = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
  const start = src.indexOf("function stripGreetingAndSignoff");
  const end = src.indexOf("\nasync function analyzeVoice");
  assert.ok(start >= 0, "stripGreetingAndSignoff not found in app.js");
  assert.ok(end > start, "analyzeVoice boundary not found after prompt helpers");
  const snippet = src.slice(start, end) + "\n;this.buildImagePrompt = buildImagePrompt;";
  const context = {};
  vm.createContext(context);
  vm.runInContext(snippet, context);
  assert.equal(typeof context.buildImagePrompt, "function");
  return context.buildImagePrompt;
}

const buildImagePrompt = loadBuildImagePrompt();
const appSource = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");

const UNEASE_POST = `Morning everyone 👋
Most people avoid feeling awkward or out of place, but those moments teach something real. It’s not about liking the hard parts, but knowing they’re a sign you’re moving forward. Lean into that unease patiently—over time, it becomes the foundation for steady, lasting results.
Enjoy the day love you all c u this arvo😘
#OnlyRealOnesKnow #Progress #ComfortInThe`;

const WISDOM_POST = `Morning everyone
Patience is a practice, not a pose.
Enjoy the day love you all c u this arvo😘
#WisdomWednesday`;

const THURSDAY_POST = `Morning everyone
This week we honour Cook Islands Māori knowledge kept alive through language, place, and community practice.
Enjoy the day love you all c u this arvo😘
#MastersOfYesterday #CookIslands`;

const FRIDAY_POST = `Morning everyone
This week held effort, listening, and quiet progress.
Enjoy the day love you all c u this arvo😘
#FridayRecap`;

const WEEKLY = `Monday: leaning into unease
Wednesday: patience in practice
Thursday: Cook Islands learning journey`;

const FAMILY_RE =
  /Father[\s\S]*Mother[\s\S]*22-year-old son[\s\S]*18-year-old son[\s\S]*12[–-]13-year-old daughter/i;

test("live path still builds selectedImagePrompt via buildImagePrompt only", () => {
  assert.match(appSource, /selectedImagePrompt\s*=\s*buildImagePrompt\(/);
  assert.match(appSource, /imagePrompt:\s*selectedImagePrompt/);
  assert.equal((appSource.match(/function buildImagePrompt/g) || []).length, 1);
  assert.doesNotMatch(appSource, /function buildImagePromptV2|second prompt|alternateImagePrompt/i);
});

test("official engine core style is present and warm natural light is absent", () => {
  const prompt = buildImagePrompt(UNEASE_POST, "Motivation Monday", "", "");
  assert.match(prompt, /official image generation engine for OROK/i);
  assert.match(prompt, /Documentary realism only/i);
  assert.match(prompt, /Must look like a genuine photograph/i);
  assert.match(prompt, /No visible writing/i);
  assert.match(prompt, /Natural available lighting/i);
  assert.doesNotMatch(prompt, /warm natural light/i);
  assert.doesNotMatch(appSource, /warm natural light/i);
});

test("Motivation Monday uses Everyday Lens and behaviour-led storytelling", () => {
  const prompt = buildImagePrompt(UNEASE_POST, "Motivation Monday", "", "");
  assert.match(prompt, /LENS: Everyday Lens/);
  assert.match(prompt, /Hero = Behaviour/);
  assert.match(prompt, /dominant behavioural pattern/i);
  assert.match(prompt, /Build the image around behaviour/i);
  assert.match(prompt, /Never around individual sentences/i);
  assert.match(prompt, /never explain the lesson/i);
  assert.match(prompt, /invites curiosity/i);
  assert.match(prompt, FAMILY_RE);
  assert.match(prompt, /Panel 1: 22-year-old son/);
  assert.match(prompt, /Panel 2: 18-year-old son/);
  assert.match(prompt, /Panel 3: 12[–-]13-year-old daughter/);
  assert.match(prompt, /Panel 4: Parents/);
  assert.match(prompt, /Never depend on facial expressions/i);
  assert.match(prompt, /No visual metaphors/i);
  assert.doesNotMatch(prompt, /messy middle/i);
  assert.doesNotMatch(prompt, /The scenes must reflect this post/i);
});

test("Wisdom Wednesday stays Everyday Lens with quieter reflective behaviour", () => {
  const prompt = buildImagePrompt(WISDOM_POST, "Wisdom Wednesday", "patience", "");
  assert.match(prompt, /LENS: Everyday Lens/);
  assert.match(prompt, /Wisdom Wednesday/i);
  assert.match(prompt, /listening, observing, conversation, patience/i);
  assert.match(prompt, /do not illustrate the post literally/i);
  assert.match(prompt, FAMILY_RE);
  assert.doesNotMatch(prompt, /warm natural light/i);
});

test("Masters of Today uses Legacy Lens and never recreates the honoured person", () => {
  const prompt = buildImagePrompt(
    "Morning everyone\nHonouring craft and contribution.\nEnjoy the day love you all c u this arvo😘\n#MastersOfToday",
    "Masters of Today",
    "a film craftsperson",
    ""
  );
  assert.match(prompt, /LENS: Legacy Lens/);
  assert.match(prompt, /Hero = Contribution/);
  assert.match(prompt, /Never recreate the honoured person/i);
  assert.match(prompt, /ordinary lives changed/i);
  assert.match(prompt, /Do NOT depict any real living person/i);
  assert.match(prompt, FAMILY_RE);
});

test("Masters of Yesterday uses Heritage Lens with culture as hero", () => {
  const prompt = buildImagePrompt(THURSDAY_POST, "Masters of Yesterday", "Cook Islands Māori", "");
  assert.match(prompt, /LENS: Heritage Lens/);
  assert.match(prompt, /Hero = Culture/);
  assert.match(prompt, /Culture is the hero/i);
  assert.match(prompt, /Family may appear only if appropriate/i);
  assert.match(prompt, /strongest cultural panel/i);
  assert.match(prompt, /does not replace or dominate the culture/i);
  assert.match(prompt, /reduce specificity rather than invent history/i);
  assert.match(prompt, /Cook Islands Māori/);
  assert.match(prompt, /No stereotypes/);
});

test("Thursday does not use unrelated historical-only panels without cultural hero rules", () => {
  const prompt = buildImagePrompt(THURSDAY_POST, "Masters of Yesterday", "Cook Islands Māori", "");
  assert.doesNotMatch(
    prompt,
    /Panel 1: culturally or historically grounded visual linked directly to the subject/i
  );
  assert.doesNotMatch(prompt, /dedicated geographic context panel showing the real-world location/i);
  assert.match(prompt, /cultural subject central and respected/i);
});

test("Friday Recap uses Recap Lens and weekly material for one connected story", () => {
  const prompt = buildImagePrompt(FRIDAY_POST, "Friday Recap", "", WEEKLY);
  assert.match(prompt, /LENS: Recap Lens/);
  assert.match(prompt, /Hero = Connection/);
  assert.match(prompt, /one connected family story/i);
  assert.match(prompt, /Do not illustrate individual posts/i);
  assert.match(prompt, /WEEKLY SOURCE MATERIAL:/);
  assert.match(prompt, /Monday: leaning into unease/);
  assert.match(prompt, /No trophies\. No victory poses\. No staged group celebration\./);
  assert.match(prompt, FAMILY_RE);
});

test("forbidden text and metaphor rules appear across family lenses", () => {
  for (const category of ["Motivation Monday", "Wisdom Wednesday", "Friday Recap"]) {
    const prompt = buildImagePrompt(UNEASE_POST, category, "", WEEKLY);
    assert.match(prompt, /No text overlays/i);
    assert.match(prompt, /No visible writing/i);
    assert.match(prompt, /No visual metaphors/i);
    assert.match(prompt, /No AI-art appearance/i);
  }
});
