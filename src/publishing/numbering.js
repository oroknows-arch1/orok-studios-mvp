"use strict";

const { ACTIVE_RESERVING_STATUSES } = require("./constants");

const COFFEE_BREAK_STREAM = "coffee-break-build";

/**
 * Compute the highest Coffee Break Build number that has actually been
 * PUBLISHED. Published numbers are permanent and are never renumbered.
 * @param {Array<any>} items
 * @returns {number} highest published series number, or 0 if none published
 */
function highestPublishedNumber(items) {
  return items
    .filter(
      (i) =>
        i.stream === COFFEE_BREAK_STREAM &&
        i.status === "published" &&
        Number.isInteger(i.seriesNumber)
    )
    .reduce((max, i) => Math.max(max, i.seriesNumber), 0);
}

/**
 * Series numbers currently reserved by an ACTIVE (non-terminal, non-published)
 * Coffee Break Build item. These are soft reservations: if such an item is
 * later rejected or archived without publishing, the number is released.
 * @param {Array<any>} items
 * @returns {Set<number>}
 */
function reservedActiveNumbers(items) {
  const reserved = new Set();
  for (const i of items) {
    if (
      i.stream === COFFEE_BREAK_STREAM &&
      ACTIVE_RESERVING_STATUSES.includes(i.status) &&
      Number.isInteger(i.seriesNumber)
    ) {
      reserved.add(i.seriesNumber);
    }
  }
  return reserved;
}

/**
 * Compute the next available public Coffee Break Build number.
 *
 * Rule: public numbers advance only when the previous entry is PUBLISHED.
 * The next candidate is `highestPublished + 1`. If that candidate is already
 * softly reserved by another active draft/review/approved item, we skip forward
 * to the next free integer. Rejected or abandoned drafts do NOT permanently
 * consume a number because their status is not in ACTIVE_RESERVING_STATUSES.
 *
 * @param {Array<any>} items
 * @param {{ excludeId?: string }} [options] optionally ignore one item (useful
 *   when recomputing a suggestion for an item that already holds a number).
 * @returns {number}
 */
function nextCoffeeBreakNumber(items, options = {}) {
  const excludeId = options.excludeId;
  const scoped = excludeId ? items.filter((i) => i.id !== excludeId) : items;

  const base = highestPublishedNumber(scoped);
  const reserved = reservedActiveNumbers(scoped);

  let candidate = base + 1;
  while (reserved.has(candidate)) {
    candidate += 1;
  }
  return candidate;
}

module.exports = {
  COFFEE_BREAK_STREAM,
  highestPublishedNumber,
  reservedActiveNumbers,
  nextCoffeeBreakNumber,
};
