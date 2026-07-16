"use strict";

/**
 * Approved OROK example references.
 *
 * Examples are reference patterns, NOT text to copy.
 * Historical two-year archive is NOT invented here.
 *
 * Import path for future approved posts:
 *   Place curated JSON/JS entries in this directory, labelled by
 *   profile, surface, quality/approval status, topic, and date.
 *   Wire them through `listExamples({ profileId, surface })`.
 *
 * Seeded only with fixtures already present for tests / repository samples.
 */

/**
 * @typedef {Object} EditorialExample
 * @property {string} id
 * @property {string} profile
 * @property {string} surface
 * @property {"approved"|"test-fixture"} quality
 * @property {string} topic
 * @property {string|null} [date]
 * @property {string} text
 * @property {string} [notes]
 */

/** @type {EditorialExample[]} */
const EXAMPLES = [
  {
    id: "ex-motivation-discipline-structure",
    profile: "motivation",
    surface: "family-message",
    quality: "approved",
    topic: "discipline as structure",
    date: null,
    text:
      "Morning everyone 👋\nDiscipline is rarely a feeling. It is usually a structure you keep when the feeling is gone — same start time, same tools, same quiet decision to begin again.\nEnjoy the day love you all c u this arvo😘",
    notes: "Pattern reference only — do not copy wording.",
  },
  {
    id: "ex-cultural-continuity-structure",
    profile: "cultural-series",
    surface: "family-message",
    quality: "test-fixture",
    topic: "cultural continuity structure",
    date: null,
    text:
      "Morning everyone 👋\nA people with named Country, seasonal work, and living knowledge is not a museum exhibit. The detail matters: where they moved, what they gathered, how care of place continued — and still continues.\nEnjoy the day love you all c u this arvo😘",
    notes: "Structural reference for Cultural Series — not a source of facts or phrases to copy.",
  },
];

/**
 * @param {{ profileId?: string, surface?: string, limit?: number }} [filter]
 * @returns {EditorialExample[]}
 */
function listExamples(filter = {}) {
  let out = EXAMPLES.slice();
  if (filter.profileId) {
    out = out.filter((e) => e.profile === filter.profileId);
  }
  if (filter.surface) {
    out = out.filter((e) => e.surface === filter.surface);
  }
  const limit = Number.isInteger(filter.limit) ? filter.limit : 3;
  return out.slice(0, limit);
}

module.exports = {
  EXAMPLES,
  listExamples,
  /**
   * Documented import location for the historical OROK archive.
   * Do not invent two years of posts; import approved posts here next.
   */
  ARCHIVE_IMPORT_PATH: "src/editorial/examples/",
  ARCHIVE_IMPORT_NOTES:
    "Add approved historical OROK posts as labelled examples (profile, surface, quality, topic, date). They are reference patterns only — prompts must prohibit copying distinctive wording.",
};
