"use strict";

const {
  CATEGORY_TO_PROFILE,
  EDITORIAL_PROFILE_IDS,
  PROFILE_LABELS,
  EditorialResolutionError,
} = require("./types");

/**
 * Established weekday defaults (ISO weekday: 1=Mon ... 7=Sun).
 * Explicit publishing category/stream overrides these defaults.
 */
const WEEKDAY_DEFAULT_PROFILE = Object.freeze({
  1: "motivation",
  2: "masters-of-today",
  3: "wisdom",
  4: "masters-of-yesterday", // Cultural Series when explicitly scheduled
  5: "friday-recap",
  6: "saturday-mixed",
  7: "long-game",
});

/**
 * Stream → default profile when category is not supplied.
 * @type {Readonly<Record<string, import("./types").EditorialProfileId>>}
 */
const STREAM_DEFAULT_PROFILE = Object.freeze({
  "orok-morning": null, // resolve from weekday
  "coffee-break-build": "coffee-break-build",
  "saturday-mixed": "saturday-mixed",
  "sunday-long-game": "long-game",
});

/**
 * @param {string|Date} [date]
 * @returns {number} ISO weekday 1–7
 */
function isoWeekday(date) {
  const d = date ? new Date(date) : new Date();
  if (Number.isNaN(d.getTime())) {
    throw new EditorialResolutionError("Invalid scheduled date", [
      "scheduledFor must be a valid date",
    ]);
  }
  const day = d.getUTCDay();
  return day === 0 ? 7 : day;
}

/**
 * Resolve editorial profile id from request context.
 * Priority:
 *   1. explicit category (label or slug)
 *   2. stream default (CBB / Sunday / Saturday)
 *   3. weekday default from scheduledFor / today
 *
 * @param {{
 *   category?: string,
 *   stream?: string,
 *   scheduledFor?: string,
 *   profile?: string,
 * }} input
 * @returns {{ profileId: import("./types").EditorialProfileId, source: string, weekday: number|null }}
 */
function resolveEditorialProfile(input = {}) {
  // Explicit profile slug wins
  if (input.profile && CATEGORY_TO_PROFILE[input.profile]) {
    return {
      profileId: CATEGORY_TO_PROFILE[input.profile],
      source: "explicit-profile",
      weekday: null,
    };
  }

  // Explicit category overrides weekday
  if (input.category && CATEGORY_TO_PROFILE[input.category]) {
    return {
      profileId: CATEGORY_TO_PROFILE[input.category],
      source: "explicit-category",
      weekday: null,
    };
  }

  if (input.category && String(input.category).trim()) {
    throw new EditorialResolutionError("Unknown editorial category", [
      `category "${input.category}" is not a recognised OROK editorial profile`,
      `known: ${Object.keys(CATEGORY_TO_PROFILE)
        .filter((k) => k.includes(" ") || k.includes("-"))
        .slice(0, 20)
        .join(", ")}`,
    ]);
  }

  const stream = input.stream || null;
  if (stream && STREAM_DEFAULT_PROFILE[stream]) {
    return {
      profileId: STREAM_DEFAULT_PROFILE[stream],
      source: "stream-default",
      weekday: null,
    };
  }

  // Weekday default (for orok-morning or when only a date is known)
  if (stream && !STREAM_DEFAULT_PROFILE.hasOwnProperty(stream) && stream !== "orok-morning") {
    throw new EditorialResolutionError("Unknown publishing stream", [
      `stream "${stream}" is not recognised`,
    ]);
  }

  const weekday = isoWeekday(input.scheduledFor || new Date().toISOString());
  const profileId = WEEKDAY_DEFAULT_PROFILE[weekday];
  if (!profileId || !EDITORIAL_PROFILE_IDS.includes(profileId)) {
    throw new EditorialResolutionError("Cannot resolve editorial profile", [
      "no weekday default available for the scheduled date",
    ]);
  }

  return {
    profileId,
    source: "weekday-default",
    weekday,
  };
}

/**
 * Human-readable schedule note for prompts/UI.
 * @param {{ profileId: string, source: string, weekday: number|null }} resolved
 */
function describeScheduleResolution(resolved) {
  const label = PROFILE_LABELS[resolved.profileId] || resolved.profileId;
  if (resolved.source === "explicit-category" || resolved.source === "explicit-profile") {
    return `Explicit publishing category/profile selected: ${label}`;
  }
  if (resolved.source === "stream-default") {
    return `Stream default selected: ${label}`;
  }
  const names = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  return `Weekday default (${names[resolved.weekday] || "day"}): ${label}`;
}

module.exports = {
  WEEKDAY_DEFAULT_PROFILE,
  STREAM_DEFAULT_PROFILE,
  isoWeekday,
  resolveEditorialProfile,
  describeScheduleResolution,
};
