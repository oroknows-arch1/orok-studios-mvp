"use strict";

/** Minimum and maximum clickable source links per Sunday Long Game edition. */
const MIN_SOURCES = 2;
const MAX_SOURCES = 5;

/**
 * Preferred primary publishers for Long Game sourcing.
 * Used for ranking and as fallback catalogue entries.
 */
const PRIMARY_PUBLISHERS = Object.freeze([
  "Reserve Bank of Australia",
  "Australian Bureau of Statistics",
  "ASIC",
  "Treasury",
  "Australian Government",
  "Company Annual Report",
  "Official Research",
]);

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidDateString(value) {
  if (typeof value !== "string" || value.trim() === "") return false;
  const parsed = Date.parse(value);
  return !Number.isNaN(parsed);
}

/**
 * Error thrown when Long Game sources fail validation.
 * Shape matches ValidationError so routes can treat them identically.
 */
class SourceValidationError extends Error {
  /**
   * @param {string} message
   * @param {string[]} [errors]
   */
  constructor(message, errors = []) {
    super(message);
    this.name = "SourceValidationError";
    this.errors = errors;
    this.statusCode = 400;
  }
}

/**
 * @typedef {Object} LongGameSource
 * @property {string} title
 * @property {string} url
 * @property {string} [publisher]
 * @property {string} [publicationDate] YYYY-MM-DD or ISO
 * @property {string} [accessDate] YYYY-MM-DD or ISO
 * @property {string} [topic]
 * @property {string} [category]
 */

/**
 * Validate that a string is an absolute http(s) URL.
 * @param {unknown} value
 * @returns {boolean}
 */
function isValidHttpUrl(value) {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    const u = new URL(value.trim());
    return u.protocol === "http:" || u.protocol === "https:";
  } catch (_e) {
    return false;
  }
}

/**
 * Normalize a partial source into a full LongGameSource.
 * @param {Partial<LongGameSource>} raw
 * @param {{accessDate?: string}} [opts]
 * @returns {LongGameSource}
 */
function normalizeSource(raw, opts = {}) {
  const accessDate =
    (raw && isNonEmptyString(raw.accessDate) && raw.accessDate.trim()) ||
    opts.accessDate ||
    new Date().toISOString().slice(0, 10);

  return {
    title: raw && typeof raw.title === "string" ? raw.title.trim() : "",
    url: raw && typeof raw.url === "string" ? raw.url.trim() : "",
    publisher:
      raw && isNonEmptyString(raw.publisher) ? raw.publisher.trim() : undefined,
    publicationDate:
      raw && isNonEmptyString(raw.publicationDate)
        ? raw.publicationDate.trim().slice(0, 10)
        : undefined,
    accessDate: String(accessDate).slice(0, 10),
    topic: raw && isNonEmptyString(raw.topic) ? raw.topic.trim() : undefined,
    category:
      raw && isNonEmptyString(raw.category) ? raw.category.trim() : undefined,
  };
}

/**
 * Collect validation errors for a single source.
 * @param {any} source
 * @param {number} [index]
 * @returns {string[]}
 */
function collectSourceErrors(source, index) {
  const label = typeof index === "number" ? `sources[${index}]` : "source";
  const errors = [];
  if (!source || typeof source !== "object") {
    return [`${label} must be an object`];
  }
  if (!isNonEmptyString(source.title)) {
    errors.push(`${label}.title is required`);
  }
  if (!isValidHttpUrl(source.url)) {
    errors.push(`${label}.url must be a valid http(s) URL`);
  }
  if (
    source.publicationDate !== undefined &&
    source.publicationDate !== null &&
    source.publicationDate !== "" &&
    !isValidDateString(String(source.publicationDate))
  ) {
    errors.push(`${label}.publicationDate must be a valid date`);
  }
  if (
    source.accessDate !== undefined &&
    source.accessDate !== null &&
    source.accessDate !== "" &&
    !isValidDateString(String(source.accessDate))
  ) {
    errors.push(`${label}.accessDate must be a valid date`);
  }
  return errors;
}

/**
 * Assert a sources array is suitable for a Sunday Long Game edition:
 * between 2 and 5 inclusive, each with a valid clickable URL.
 * @param {any} sources
 * @returns {LongGameSource[]}
 */
function assertLongGameSources(sources) {
  if (!Array.isArray(sources)) {
    throw new SourceValidationError("Invalid sources", [
      "Sunday Long Game requires a sources array",
    ]);
  }
  if (sources.length < MIN_SOURCES || sources.length > MAX_SOURCES) {
    throw new SourceValidationError("Invalid sources", [
      `Sunday Long Game requires between ${MIN_SOURCES} and ${MAX_SOURCES} source links (got ${sources.length})`,
    ]);
  }
  const errors = [];
  const normalized = sources.map((s, i) => {
    const n = normalizeSource(s);
    errors.push(...collectSourceErrors(n, i));
    return n;
  });
  // Deduplicate by URL
  const seen = new Set();
  for (const s of normalized) {
    const key = s.url.toLowerCase();
    if (seen.has(key)) {
      errors.push(`duplicate source URL: ${s.url}`);
    }
    seen.add(key);
  }
  if (errors.length) {
    throw new SourceValidationError("Invalid sources", errors);
  }
  return normalized;
}

/**
 * Clamp and validate sources, preferring primary publishers when ranking.
 * Returns between MIN and MAX sources or throws if fewer than MIN valid.
 * @param {Array<Partial<LongGameSource>>} candidates
 * @param {{accessDate?: string, preferPrimary?: boolean}} [opts]
 * @returns {LongGameSource[]}
 */
function selectSources(candidates, opts = {}) {
  const accessDate = opts.accessDate || new Date().toISOString().slice(0, 10);
  const preferPrimary = opts.preferPrimary !== false;

  const valid = [];
  for (const raw of candidates || []) {
    const n = normalizeSource(raw, { accessDate });
    if (collectSourceErrors(n).length === 0) valid.push(n);
  }

  // Deduplicate by URL, keep first
  const unique = [];
  const seen = new Set();
  for (const s of valid) {
    const key = s.url.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(s);
  }

  if (preferPrimary) {
    unique.sort((a, b) => {
      const ap = isPrimaryPublisher(a.publisher) ? 0 : 1;
      const bp = isPrimaryPublisher(b.publisher) ? 0 : 1;
      return ap - bp;
    });
  }

  if (unique.length < MIN_SOURCES) {
    throw new SourceValidationError("Invalid sources", [
      `need at least ${MIN_SOURCES} valid source links (got ${unique.length})`,
    ]);
  }

  return unique.slice(0, MAX_SOURCES);
}

/**
 * @param {string|undefined} publisher
 * @returns {boolean}
 */
function isPrimaryPublisher(publisher) {
  if (!publisher) return false;
  const q = publisher.toLowerCase();
  return PRIMARY_PUBLISHERS.some(
    (p) => q.includes(p.toLowerCase()) || p.toLowerCase().includes(q)
  );
}

/**
 * Render the mandatory Sources footer with clickable markdown links.
 * @param {LongGameSource[]} sources
 * @returns {string}
 */
function formatSourcesFooter(sources) {
  const lines = ["Sources"];
  for (const s of sources) {
    const label = s.publisher ? `${s.title} (${s.publisher})` : s.title;
    lines.push(`- [${label}](${s.url})`);
  }
  return lines.join("\n");
}

/**
 * Streams that must NOT carry clickable source links.
 */
const SOURCE_FREE_STREAMS = Object.freeze([
  "orok-morning",
  "coffee-break-build",
  "saturday-mixed",
]);

/**
 * Category / stream labels that must not receive source footers in generated text.
 * Covers editorial names used outside the publishing stream enum.
 */
const SOURCE_FREE_POST_LABELS = Object.freeze([
  "Motivation Monday",
  "Words of Wisdom",
  "Wisdom Wednesday",
  "Masters of Today",
  "Masters of Yesterday",
  "Coffee Break Build",
]);

/**
 * @param {string} stream
 * @returns {boolean}
 */
function streamAllowsSources(stream) {
  return stream === "sunday-long-game";
}

/**
 * @param {string} [label]
 * @returns {boolean}
 */
function postLabelAllowsSources(label) {
  if (!label) return false;
  if (SOURCE_FREE_POST_LABELS.some((l) => l.toLowerCase() === label.toLowerCase())) {
    return false;
  }
  return /long\s*game/i.test(label) || label === "sunday-long-game";
}

module.exports = {
  MIN_SOURCES,
  MAX_SOURCES,
  PRIMARY_PUBLISHERS,
  SOURCE_FREE_STREAMS,
  SOURCE_FREE_POST_LABELS,
  SourceValidationError,
  isValidHttpUrl,
  normalizeSource,
  collectSourceErrors,
  assertLongGameSources,
  selectSources,
  isPrimaryPublisher,
  formatSourcesFooter,
  streamAllowsSources,
  postLabelAllowsSources,
};
