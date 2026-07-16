"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  processGeneratedPosts,
  cleanPost,
  GENERATOR_CATEGORIES,
  StubPostGenerator,
} = require("../src/generator");

test("GENERATOR_CATEGORIES matches the Create Post UI set", () => {
  assert.deepEqual(GENERATOR_CATEGORIES, [
    "Motivation Monday",
    "Masters of Today",
    "Wisdom Wednesday",
    "Masters of Yesterday",
    "Friday Recap",
    "Friday Freestyle",
  ]);
});

test("cleanPost wraps with greeting and signoff", () => {
  const out = cleanPost("Something real happened today.");
  assert.match(out, /^Morning everyone/);
  assert.match(out, /Enjoy the day/);
  assert.match(out, /Something real happened today/);
});

test("processGeneratedPosts splits on --- and adds hashtags", () => {
  const raw = [
    "First candidate ends here.",
    "---",
    "Second candidate ends here.",
    "---",
    "Third candidate ends here.",
  ].join("\n");
  const posts = processGeneratedPosts(raw, "Motivation Monday", "discipline");
  assert.equal(posts.length, 3);
  for (const p of posts) {
    assert.match(p, /Morning everyone/);
    assert.match(p, /#/);
  }
});

test("StubPostGenerator never needs OpenAI", async () => {
  const gen = new StubPostGenerator();
  const result = await gen.generatePosts({
    idea: "growth",
    category: "Motivation Monday",
  });
  assert.equal(result.posts.length, 3);
  assert.ok(result.text.includes("\n\n\n"));
});
