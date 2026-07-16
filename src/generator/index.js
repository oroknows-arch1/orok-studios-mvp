"use strict";

/**
 * Post generation capability used by both the legacy `/generate` route and the
 * Publishing Draft Generation (v0.4) flow.
 *
 * Interface (duck-typed):
 *   generatePosts({ idea, category, weeklyPosts?, voiceProfile? })
 *     → Promise<{ posts: string[], text: string }>
 *
 * Publishing never calls OpenAI directly — it goes through this interface so
 * tests can inject a stub and production can share one OpenAI-backed instance
 * with the existing generator UI.
 */

const { GENERATOR_CATEGORIES, GREETING, SIGNOFF, MAX_CHARS } = require("./constants");
const {
  OpenAIPostGenerator,
  StubPostGenerator,
} = require("./openai-post-generator");
const postUtils = require("./post-utils");

/**
 * Create the default OpenAI-backed post generator.
 * @param {import("openai").default} openai
 * @param {{ model?: string }} [opts]
 * @returns {OpenAIPostGenerator}
 */
function createPostGenerator(openai, opts) {
  return new OpenAIPostGenerator(openai, opts);
}

module.exports = {
  createPostGenerator,
  OpenAIPostGenerator,
  StubPostGenerator,
  GENERATOR_CATEGORIES,
  GREETING,
  SIGNOFF,
  MAX_CHARS,
  ...postUtils,
};
