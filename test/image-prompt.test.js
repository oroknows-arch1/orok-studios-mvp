"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

/**
 * Load the live app.js prompt builder used by /generate-image (one path only).
 */
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

const FAMILY_RE = /mother,\s*father,\s*22-year-old son,\s*18-year-old son,\s*12[–-]13-year-old daughter/i;

test("live path still builds selectedImagePrompt via buildImagePrompt only", () => {
  assert.match(appSource, /selectedImagePrompt\s*=\s*buildImagePrompt\(/);
  assert.match(appSource, /imagePrompt:\s*selectedImagePrompt/);
  assert.equal((appSource.match(/function buildImagePrompt/g) || []).length, 1);
  assert.doesNotMatch(appSource, /function buildImagePromptV2|second prompt|alternateImagePrompt/i);
});

test("warm natural light is absent from buildImagePrompt output and source", () => {
  for (const category of [
    "Motivation Monday",
    "Masters of Today",
    "Wisdom Wednesday",
    "Masters of Yesterday",
    "Friday Recap",
    "Friday Freestyle",
  ]) {
    const prompt = buildImagePrompt(UNEASE_POST, category, "Cook Islands", WEEKLY);
    assert.doesNotMatch(prompt, /warm natural light/i);
  }
  assert.doesNotMatch(appSource, /warm natural light/i);
});

test("lighting is determined naturally by the scene", () => {
  const monday = buildImagePrompt(UNEASE_POST, "Motivation Monday", "", "");
  assert.match(monday, /determined naturally by the scene/i);
  assert.doesNotMatch(monday, /warm natural lighting/i);
});

test("Motivation Monday requests one connected behaviour-led family story", () => {
  const prompt = buildImagePrompt(UNEASE_POST, "Motivation Monday", "", "");
  assert.match(prompt, FAMILY_RE);
  assert.match(prompt, /four connected moments of one family story/i);
  assert.match(prompt, /underlying human observation/i);
  assert.match(prompt, /repeating|correcting|pausing|checking|restarting|cleaning up|trying again|quiet guidance/i);
  assert.match(prompt, /Nobody poses\. Nobody celebrates\. Nobody has already succeeded\./i);
  assert.match(prompt, /documentary realism/i);
  assert.match(prompt, /Do not illustrate the wording literally/i);
  assert.doesNotMatch(prompt, /messy middle/i);
  assert.doesNotMatch(prompt, /crossed-out or unfinished plans/i);
});

test("Motivation Monday avoids stock-photo and literal caption illustration", () => {
  const prompt = buildImagePrompt(UNEASE_POST, "Motivation Monday", "", "");
  assert.match(prompt, /no generic stock-photo appearance/i);
  assert.match(prompt, /for observation only — do not illustrate literally/i);
  assert.match(prompt, /no motivational-advertising composition/i);
  assert.doesNotMatch(prompt, /The scenes must reflect this post/i);
});

test("Wisdom Wednesday requests a quiet reflective family story", () => {
  const prompt = buildImagePrompt(WISDOM_POST, "Wisdom Wednesday", "patience", "");
  assert.match(prompt, FAMILY_RE);
  assert.match(prompt, /quieter, reflective family story/i);
  assert.match(prompt, /listening|observing|conversation|patience|helping|remembering|considering|quiet reflection/i);
  assert.match(prompt, /connected by one theme/i);
  assert.match(prompt, /Do not illustrate the post literally/i);
  assert.match(prompt, /thoughtful and naturally observed/i);
  assert.match(prompt, /documentary realism/i);
  assert.doesNotMatch(prompt, /warm natural light/i);
});

test("Masters of Yesterday keeps the OROK family and one strong authentic cultural panel", () => {
  const prompt = buildImagePrompt(THURSDAY_POST, "Masters of Yesterday", "Cook Islands Māori", "");
  assert.match(prompt, FAMILY_RE);
  assert.match(prompt, /visual thread/i);
  assert.match(prompt, /Panel 3: The strongest cultural panel/i);
  assert.match(prompt, /cultural subject central and respected/i);
  assert.match(prompt, /Cook Islands Māori/);
  assert.match(prompt, /Thursday post:/i);
  assert.match(prompt, /Selected cultural subject:/i);
});

test("Thursday does not replace the family with unrelated historical-only subjects", () => {
  const prompt = buildImagePrompt(THURSDAY_POST, "Masters of Yesterday", "Cook Islands Māori", "");
  assert.match(prompt, /family entering, arriving at, or moving through/i);
  assert.match(prompt, /family respectfully observing, listening, or learning/i);
  assert.match(prompt, /family quietly reflecting, continuing their journey/i);
  assert.doesNotMatch(
    prompt,
    /Panel 1: culturally or historically grounded visual linked directly to the subject/i
  );
  assert.doesNotMatch(prompt, /dedicated geographic context panel showing the real-world location/i);
});

test("Thursday does not let the family dominate the featured culture", () => {
  const prompt = buildImagePrompt(THURSDAY_POST, "Masters of Yesterday", "Cook Islands Māori", "");
  assert.match(prompt, /family does not replace or dominate it/i);
  assert.match(prompt, /experiences and learns from the culture/i);
  assert.match(prompt, /no stereotypes/i);
  assert.match(prompt, /no costume-like treatment/i);
  assert.match(prompt, /no fake ceremonies/i);
  assert.match(prompt, /no invented cultural details/i);
});

test("Friday Recap uses weekly material for a connected family journey", () => {
  const prompt = buildImagePrompt(FRIDAY_POST, "Friday Recap", "", WEEKLY);
  assert.match(prompt, FAMILY_RE);
  assert.match(prompt, /one connected family journey/i);
  assert.match(prompt, /WEEKLY SOURCE MATERIAL:/i);
  assert.match(prompt, /Monday: leaning into unease/);
  assert.match(prompt, /No trophies\. No victory poses\. No staged group celebration\./i);
  assert.match(prompt, /Do not create generic Friday celebration scenes/i);
  assert.match(prompt, /Do not illustrate captions literally/i);
  assert.match(prompt, /documentary realism/i);
});

test("messy middle fixed example is removed from permanent Monday prompt", () => {
  const prompt = buildImagePrompt(UNEASE_POST, "Motivation Monday", "", "");
  assert.doesNotMatch(prompt, /EXAMPLE \(when the observation is unfinished progress/i);
  assert.doesNotMatch(prompt, /resetting after a mistake in training/i);
  assert.doesNotMatch(prompt, /repeating the same dance movement/i);
});
