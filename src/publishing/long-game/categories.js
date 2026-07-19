"use strict";

/**
 * Weekly source categories evaluated every Sunday by the Long Game engine.
 * Additional categories may be registered at runtime via `registerCategory`.
 */
const DEFAULT_WEEKLY_CATEGORIES = Object.freeze([
  "Australian Economy",
  "Global Economy",
  "Business",
  "Employment",
  "Artificial Intelligence",
  "Technology",
  "Markets",
  "Cost of Living",
  "Government Policy",
  "Energy",
  "Supply Chains",
  "Agriculture",
]);

/** @type {string[]} mutable registry (starts from defaults) */
const _categories = [...DEFAULT_WEEKLY_CATEGORIES];

/**
 * @returns {readonly string[]}
 */
function listCategories() {
  return Object.freeze([..._categories]);
}

/**
 * Register an additional weekly source category (extensible).
 * @param {string} name
 * @returns {boolean} true if newly added
 */
function registerCategory(name) {
  if (typeof name !== "string" || !name.trim()) {
    throw new Error("category name must be a non-empty string");
  }
  const trimmed = name.trim();
  if (_categories.some((c) => c.toLowerCase() === trimmed.toLowerCase())) {
    return false;
  }
  _categories.push(trimmed);
  return true;
}

/**
 * Reset the registry to the default set (for tests).
 */
function resetCategories() {
  _categories.length = 0;
  _categories.push(...DEFAULT_WEEKLY_CATEGORIES);
}

/**
 * @param {string} name
 * @returns {boolean}
 */
function isKnownCategory(name) {
  if (typeof name !== "string") return false;
  const q = name.trim().toLowerCase();
  return _categories.some((c) => c.toLowerCase() === q);
}

module.exports = {
  DEFAULT_WEEKLY_CATEGORIES,
  listCategories,
  registerCategory,
  resetCategories,
  isKnownCategory,
};
