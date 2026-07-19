"use strict";

const { formatSourcesFooter, assertLongGameSources } = require("./sources");

/**
 * @typedef {Object} LongGameEditionContent
 * @property {string} title
 * @property {string} body
 * @property {string} familyLesson
 * @property {string} macroSignal
 * @property {string} dominantPattern
 * @property {import("./sources").LongGameSource[]} sources
 */

/**
 * Assemble the canonical Sunday Long Game post body.
 * Every edition must contain: Title, Body, One practical family lesson,
 * Macro Signal, Dominant Pattern, Sources.
 *
 * @param {LongGameEditionContent} content
 * @returns {string}
 */
function formatLongGamePost(content) {
  const sources = assertLongGameSources(content.sources);
  const title = String(content.title || "").trim();
  const body = String(content.body || "").trim();
  const familyLesson = String(content.familyLesson || "").trim();
  const macroSignal = String(content.macroSignal || "").trim();
  const dominantPattern = String(content.dominantPattern || "").trim();

  if (!title) throw new Error("Long Game post requires a title");
  if (!body) throw new Error("Long Game post requires a body");
  if (!familyLesson) throw new Error("Long Game post requires a family lesson");
  if (!macroSignal) throw new Error("Long Game post requires a macro signal");
  if (!dominantPattern) throw new Error("Long Game post requires a dominant pattern");

  const sections = [
    title,
    "",
    body,
    "",
    `Practical family lesson: ${familyLesson}`,
    "",
    `Macro Signal: ${macroSignal}`,
    `Dominant Pattern: ${dominantPattern}`,
    "",
    formatSourcesFooter(sources),
  ];
  return sections.join("\n");
}

/**
 * Shorter X-oriented version. Same required structure, tighter body.
 * @param {LongGameEditionContent} content
 * @param {{maxChars?: number}} [opts]
 * @returns {string}
 */
function formatLongGameXPost(content, opts = {}) {
  const sources = assertLongGameSources(content.sources);
  const title = String(content.title || "").trim();
  const body = String(content.body || "").trim();
  const familyLesson = String(content.familyLesson || "").trim();
  const macroSignal = String(content.macroSignal || "").trim();
  const dominantPattern = String(content.dominantPattern || "").trim();

  const maxChars = opts.maxChars || 2800;
  let text = [
    title,
    "",
    body,
    "",
    `Family lesson: ${familyLesson}`,
    `Macro Signal: ${macroSignal}`,
    `Pattern: ${dominantPattern}`,
    "",
    formatSourcesFooter(sources),
  ].join("\n");

  if (text.length > maxChars) {
    // Prefer trimming the body while keeping lesson, signal, pattern, sources.
    const footer = [
      "",
      `Family lesson: ${familyLesson}`,
      `Macro Signal: ${macroSignal}`,
      `Pattern: ${dominantPattern}`,
      "",
      formatSourcesFooter(sources),
    ].join("\n");
    const budget = Math.max(40, maxChars - footer.length - title.length - 4);
    const trimmedBody =
      body.length > budget ? body.slice(0, budget - 1).trimEnd() + "…" : body;
    text = [title, "", trimmedBody, footer].join("\n");
  }
  return text;
}

/**
 * Parse whether a post text already ends with a Sources section containing links.
 * @param {string} text
 * @returns {boolean}
 */
function textHasSourcesFooter(text) {
  if (typeof text !== "string") return false;
  const idx = text.lastIndexOf("\nSources\n");
  if (idx === -1 && !text.startsWith("Sources\n")) return false;
  const footer = idx === -1 ? text : text.slice(idx);
  // At least two markdown or bare http(s) links
  const mdLinks = footer.match(/\[[^\]]+\]\(https?:\/\/[^)]+\)/g) || [];
  const bareLinks = footer.match(/https?:\/\/\S+/g) || [];
  const count = Math.max(mdLinks.length, bareLinks.length);
  return count >= 2;
}

/**
 * Extract structured fields from a formatted Long Game post (best-effort).
 * @param {string} text
 * @returns {{title?:string, familyLesson?:string, macroSignal?:string, dominantPattern?:string}}
 */
function parseLongGameFields(text) {
  if (typeof text !== "string") return {};
  const lines = text.split("\n");
  const title = (lines[0] || "").trim() || undefined;
  let familyLesson;
  let macroSignal;
  let dominantPattern;
  for (const line of lines) {
    const fl = line.match(/^Practical family lesson:\s*(.+)$/i) ||
      line.match(/^Family lesson:\s*(.+)$/i);
    if (fl) familyLesson = fl[1].trim();
    const ms = line.match(/^Macro Signal:\s*(.+)$/i);
    if (ms) macroSignal = ms[1].trim();
    const dp =
      line.match(/^Dominant Pattern:\s*(.+)$/i) ||
      line.match(/^Pattern:\s*(.+)$/i);
    if (dp) dominantPattern = dp[1].trim();
  }
  return { title, familyLesson, macroSignal, dominantPattern };
}

module.exports = {
  formatLongGamePost,
  formatLongGameXPost,
  textHasSourcesFooter,
  parseLongGameFields,
};
