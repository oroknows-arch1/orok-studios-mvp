"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

/**
 * Load the live app.js prompt builder used by /generate-image (one path only).
 */
function loadBuildImagePrompt() {
  const src = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
  const el = () => ({
    value: "",
    style: { display: "" },
    innerText: "",
    innerHTML: "",
    src: "",
    addEventListener() {},
  });
  const context = {
    document: {
      getElementById: () => el(),
      querySelectorAll: () => [],
    },
    fetch: async () => ({
      headers: { get: () => "application/json" },
      json: async () => ({}),
      text: async () => "",
    }),
    console,
  };
  vm.createContext(context);
  vm.runInContext(src, context);
  assert.equal(typeof context.buildImagePrompt, "function");
  return context.buildImagePrompt;
}

const buildImagePrompt = loadBuildImagePrompt();

const MESSY_MIDDLE_POST = `Morning everyone

The messy middle is where most people quit. Not because the idea was wrong — because the path got unfinished, crossed out, and awkward. Keep going through the imperfect part.

Enjoy the day love you all c u this arvo😘
#MotivationMonday #Family #KeepGoing`;

test("Motivation Monday keeps family structure, documentary realism, 4 panels, no text", () => {
  const prompt = buildImagePrompt(MESSY_MIDDLE_POST, "Motivation Monday", "messy middle", "");
  assert.match(prompt, /4-panel family collage/i);
  assert.match(prompt, /5-member Polynesian\s*\/\s*Pasifika family/i);
  assert.match(prompt, /documentary realism/i);
  assert.match(prompt, /no text overlays/i);
  assert.match(prompt, /clear family resemblance/i);
  assert.match(prompt, /natural everyday settings/i);
});

test("Motivation Monday requires one connected narrative across four panels", () => {
  const prompt = buildImagePrompt(MESSY_MIDDLE_POST, "Motivation Monday", "messy middle", "");
  assert.match(prompt, /one connected visual story across all four panels/i);
  assert.match(prompt, /same underlying theme/i);
  assert.match(prompt, /different moment of that same theme/i);
  assert.match(prompt, /not four unrelated stock-photo activities/i);
  assert.doesNotMatch(
    prompt,
    /Each panel must show a different activity AND a different setting/i
  );
  assert.doesNotMatch(prompt, /DIFFERENT skill activity/i);
});

test("Motivation Monday avoids generic stock-photo / hard-work wording as the creative brief", () => {
  const prompt = buildImagePrompt(MESSY_MIDDLE_POST, "Motivation Monday", "messy middle", "");
  assert.match(prompt, /avoid generic stock-photo feel/i);
  assert.match(prompt, /Avoid generic .hard work. images/i);
  assert.doesNotMatch(prompt, /structured effort \(work, training, focused responsibility\)/i);
  assert.doesNotMatch(prompt, /emotion: calm, focused, steady effort/i);
});

test("Motivation Monday is behaviour-driven, not exaggerated expression or achievement", () => {
  const prompt = buildImagePrompt(MESSY_MIDDLE_POST, "Motivation Monday", "messy middle", "");
  assert.match(prompt, /through behaviour/i);
  assert.match(prompt, /not exaggerated facial expressions/i);
  assert.match(prompt, /repetition|correction|restarting|unfinished work|waiting|checking/i);
  assert.match(prompt, /Avoid posed achievement scenes/i);
  assert.match(prompt, /Avoid generic .hard work. images/i);
  assert.match(prompt, /Avoid motivational-advertising composition/i);
  assert.match(prompt, /steady, imperfect, unfinished, trying again/i);
});

test("Motivation Monday must not ask for literal illustration of the caption", () => {
  const prompt = buildImagePrompt(MESSY_MIDDLE_POST, "Motivation Monday", "messy middle", "");
  assert.match(prompt, /Do not illustrate the post literally/i);
  assert.match(prompt, /underlying human observation/i);
  assert.match(prompt, /for observation only/i);
  assert.doesNotMatch(prompt, /The scenes must reflect this post/i);
  assert.doesNotMatch(prompt, /The visuals must reflect this/i);
});

test("Motivation Monday messy-middle example panels are connected, not unrelated activities", () => {
  const prompt = buildImagePrompt(MESSY_MIDDLE_POST, "Motivation Monday", "messy middle", "");
  assert.match(prompt, /working through crossed-out or unfinished plans/i);
  assert.match(prompt, /resetting after a mistake in training/i);
  assert.match(prompt, /repeating the same dance movement/i);
  assert.match(prompt, /quietly helping review progress or guide the next attempt/i);
  assert.doesNotMatch(prompt, /structured effort \(work, training, focused responsibility\)/i);
});

test("Wisdom Wednesday family collage also uses connected non-literal storytelling", () => {
  const prompt = buildImagePrompt(
    "Morning everyone\n\nPatience is a practice, not a pose.\n\nEnjoy the day love you all c u this arvo😘\n#WisdomWednesday",
    "Wisdom Wednesday",
    "patience",
    ""
  );
  assert.match(prompt, /one connected visual story across all four panels/i);
  assert.match(prompt, /Do not illustrate the post literally/i);
  assert.match(prompt, /through behaviour/i);
  assert.doesNotMatch(
    prompt,
    /Each panel must show a different activity AND a different setting/i
  );
  assert.doesNotMatch(prompt, /The visuals must reflect this Wisdom post/i);
});
