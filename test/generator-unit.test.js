"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  processGeneratedPosts,
  cleanPost,
  GENERATOR_CATEGORIES,
  StubPostGenerator,
} = require("../src/generator");

test("GENERATOR_CATEGORIES includes full OROK editorial set", () => {
  assert.ok(GENERATOR_CATEGORIES.includes("Motivation Monday"));
  assert.ok(GENERATOR_CATEGORIES.includes("Cultural Series"));
  assert.ok(GENERATOR_CATEGORIES.includes("Coffee Break Build"));
  assert.ok(GENERATOR_CATEGORIES.includes("Long Game"));
  assert.ok(GENERATOR_CATEGORIES.includes("Saturday Mixed Pack"));
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

test("StubPostGenerator never needs OpenAI and uses editorial profile", async () => {
  const gen = new StubPostGenerator();
  const result = await gen.generatePosts({
    idea: "growth",
    category: "Motivation Monday",
    surface: "family-message",
  });
  assert.equal(result.posts.length, 3);
  assert.ok(result.text.includes("\n\n\n"));
  assert.equal(result.editorial.editorialProfile, "motivation");
  assert.equal(result.editorial.validationStatus, "passed");
});
