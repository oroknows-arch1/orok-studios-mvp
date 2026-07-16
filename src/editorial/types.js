"use strict";

/**
 * Canonical OROK editorial types (CommonJS — matches repo conventions).
 */

/** @typedef {"family-message"|"x-post"} OutputSurface */

/** @typedef {"motivation"|"masters-of-today"|"wisdom"|"masters-of-yesterday"|"cultural-series"|"friday-recap"|"friday-freestyle"|"coffee-break-build"|"long-game"|"saturday-mixed"} EditorialProfileId */

/** @type {readonly EditorialProfileId[]} */
const EDITORIAL_PROFILE_IDS = Object.freeze([
  "motivation",
  "masters-of-today",
  "wisdom",
  "masters-of-yesterday",
  "cultural-series",
  "friday-recap",
  "friday-freestyle",
  "coffee-break-build",
  "long-game",
  "saturday-mixed",
]);

/** @type {readonly OutputSurface[]} */
const OUTPUT_SURFACES = Object.freeze(["family-message", "x-post"]);

/**
 * Map legacy generator category labels → editorial profile ids.
 * @type {Readonly<Record<string, EditorialProfileId>>}
 */
const CATEGORY_TO_PROFILE = Object.freeze({
  "Motivation Monday": "motivation",
  "Masters of Today": "masters-of-today",
  "Wisdom Wednesday": "wisdom",
  "Masters of Yesterday": "masters-of-yesterday",
  "Cultural Series": "cultural-series",
  "Friday Recap": "friday-recap",
  "Friday Freestyle": "friday-freestyle",
  "Coffee Break Build": "coffee-break-build",
  "Long Game": "long-game",
  "Saturday Mixed Pack": "saturday-mixed",
  // slug forms accepted on API
  motivation: "motivation",
  "masters-of-today": "masters-of-today",
  wisdom: "wisdom",
  "masters-of-yesterday": "masters-of-yesterday",
  "cultural-series": "cultural-series",
  "friday-recap": "friday-recap",
  "friday-freestyle": "friday-freestyle",
  "coffee-break-build": "coffee-break-build",
  "long-game": "long-game",
  "saturday-mixed": "saturday-mixed",
});

/**
 * Human labels for UI.
 * @type {Readonly<Record<EditorialProfileId, string>>}
 */
const PROFILE_LABELS = Object.freeze({
  motivation: "Motivation",
  "masters-of-today": "Masters of Today",
  wisdom: "Wisdom",
  "masters-of-yesterday": "Masters of Yesterday",
  "cultural-series": "Cultural Series",
  "friday-recap": "Friday Recap",
  "friday-freestyle": "Friday Freestyle",
  "coffee-break-build": "Coffee Break Build",
  "long-game": "Long Game",
  "saturday-mixed": "Saturday Mixed Pack",
});

/**
 * @typedef {Object} EditorialProfile
 * @property {EditorialProfileId} id
 * @property {string} label
 * @property {string} purpose
 * @property {string[]} must
 * @property {string[]} mustNot
 * @property {{ min?: number, max?: number }} lengthTarget
 * @property {boolean} requiresGrounding
 * @property {string[]} groundingKeys
 * @property {string} reasoningNotes
 */

/**
 * @typedef {Object} ResolvedEditorialContext
 * @property {EditorialProfileId} profileId
 * @property {EditorialProfile} profile
 * @property {OutputSurface} surface
 * @property {string|null} stream
 * @property {string|null} category
 * @property {string} topic
 * @property {string|null} scheduledFor
 * @property {object|null} grounding
 * @property {object[]} recentContext
 * @property {object[]} examples
 * @property {string|null} weeklyPosts
 * @property {object|null} voiceProfile
 */

class EditorialResolutionError extends Error {
  /**
   * @param {string} message
   * @param {string[]} [errors]
   */
  constructor(message, errors = []) {
    super(message);
    this.name = "EditorialResolutionError";
    this.errors = errors;
    this.statusCode = 400;
  }
}

class EditorialValidationError extends Error {
  /**
   * @param {string} message
   * @param {string[]} [errors]
   */
  constructor(message, errors = []) {
    super(message);
    this.name = "EditorialValidationError";
    this.errors = errors;
    this.statusCode = 422;
  }
}

class NeedsGroundingError extends Error {
  /**
   * @param {string} message
   * @param {string[]} [missing]
   */
  constructor(message, missing = []) {
    super(message);
    this.name = "NeedsGroundingError";
    this.missing = missing;
    this.statusCode = 422;
    this.code = "needs_grounding";
  }
}

module.exports = {
  EDITORIAL_PROFILE_IDS,
  OUTPUT_SURFACES,
  CATEGORY_TO_PROFILE,
  PROFILE_LABELS,
  EditorialResolutionError,
  EditorialValidationError,
  NeedsGroundingError,
};
