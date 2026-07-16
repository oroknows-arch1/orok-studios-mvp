"use strict";

/**
 * Canonical publishing streams.
 * @typedef {"orok-morning"|"coffee-break-build"|"saturday-mixed"|"sunday-long-game"} PublishingStream
 */
const STREAMS = Object.freeze([
  "orok-morning",
  "coffee-break-build",
  "saturday-mixed",
  "sunday-long-game",
]);

/**
 * Canonical publishing status values.
 * @typedef {"idea"|"draft"|"review"|"approved"|"published"|"archived"|"rejected"} PublishingStatus
 */
const STATUSES = Object.freeze([
  "idea",
  "draft",
  "review",
  "approved",
  "published",
  "archived",
  "rejected",
]);

/**
 * Legal status transitions. A key maps to the set of statuses it may move to.
 * The canonical happy path is:
 *   idea -> draft -> review -> approved -> published -> archived
 * `rejected` is reachable from any active (non-terminal) state and is preserved
 * so the system never silently recreates a rejected item.
 *
 * Terminal states (`archived`, `rejected`) have no outgoing transitions.
 */
const TRANSITIONS = Object.freeze({
  idea: Object.freeze(["draft", "review", "rejected", "archived"]),
  draft: Object.freeze(["review", "rejected", "archived"]),
  review: Object.freeze(["approved", "draft", "rejected", "archived"]),
  approved: Object.freeze(["published", "review", "draft", "rejected", "archived"]),
  published: Object.freeze(["archived"]),
  archived: Object.freeze([]),
  rejected: Object.freeze([]),
});

/**
 * Statuses that actively "reserve" a Coffee Break Build number. A number that is
 * only held by an item in one of these states is a soft reservation and is
 * released if that item is later rejected/archived without being published.
 */
const ACTIVE_RESERVING_STATUSES = Object.freeze([
  "idea",
  "draft",
  "review",
  "approved",
]);

/**
 * Default weekly publishing rhythm. This is planning metadata only in v0.1 and
 * does NOT drive any automatic generation.
 * Keys are ISO weekday numbers (1 = Monday ... 7 = Sunday).
 */
const DEFAULT_RHYTHM = Object.freeze({
  1: Object.freeze({ morning: "orok-morning", evening: "coffee-break-build" }),
  2: Object.freeze({ morning: "orok-morning", evening: "coffee-break-build" }),
  3: Object.freeze({ morning: "orok-morning", evening: "coffee-break-build" }),
  4: Object.freeze({ morning: "orok-morning", evening: "coffee-break-build" }),
  5: Object.freeze({ morning: "orok-morning", evening: "coffee-break-build" }),
  6: Object.freeze({ allDay: "saturday-mixed" }),
  7: Object.freeze({ allDay: "sunday-long-game" }),
});

/** Daypart used to position an item within a day's queue. */
const DAYPARTS = Object.freeze(["morning", "evening", "allday"]);

/** Human-friendly labels for streams (UI convenience). */
const STREAM_LABELS = Object.freeze({
  "orok-morning": "OROK Morning",
  "coffee-break-build": "Coffee Break Build",
  "saturday-mixed": "Saturday Mixed Pack",
  "sunday-long-game": "Sunday Long Game",
});

module.exports = {
  STREAMS,
  STATUSES,
  TRANSITIONS,
  ACTIVE_RESERVING_STATUSES,
  DEFAULT_RHYTHM,
  DAYPARTS,
  STREAM_LABELS,
};
