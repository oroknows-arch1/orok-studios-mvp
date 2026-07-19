"use strict";

const { COUNTRY_STREAMS, ROTATION_VERSION, ANCHOR_THURSDAY } = require("./countries");
const { localParts, resolveTimeZone } = require("../schedule/timezone");

/**
 * Parse YYYY-MM-DD as a UTC noon date (avoids DST edge issues for day math).
 * @param {string} dateStr
 */
function parseDateOnly(dateStr) {
  const [y, m, d] = String(dateStr).slice(0, 10).split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

/**
 * Count whole weeks between two Thursday dates (inclusive of end relative to start).
 * @param {string} fromDateStr
 * @param {string} toDateStr
 */
function thursdayIndexFromAnchor(scheduledThursday, anchor = ANCHOR_THURSDAY) {
  const a = parseDateOnly(anchor);
  const t = parseDateOnly(scheduledThursday);
  if (t < a) {
    // Before anchor: still deterministic via negative modulo
    const days = Math.floor((t - a) / 86400000);
    const weeks = Math.floor(days / 7);
    return weeks;
  }
  const days = Math.floor((t - a) / 86400000);
  return Math.floor(days / 7);
}

/**
 * Resolve country stream for a scheduled Thursday date string (YYYY-MM-DD).
 * @param {string} scheduledThursday
 * @returns {{countryStream: object, rotationIndex: number, rotationVersion: string, scheduledDate: string}}
 */
function resolveCountryForThursday(scheduledThursday) {
  const weeks = thursdayIndexFromAnchor(scheduledThursday);
  const rotationIndex = ((weeks % COUNTRY_STREAMS.length) + COUNTRY_STREAMS.length) % COUNTRY_STREAMS.length;
  return {
    scheduledDate: String(scheduledThursday).slice(0, 10),
    countryStream: COUNTRY_STREAMS[rotationIndex],
    rotationIndex,
    rotationVersion: ROTATION_VERSION,
    weeksFromAnchor: weeks,
  };
}

/**
 * Local Thursday date string for a given instant in PUBLISHING_TIMEZONE.
 * If `now` is not Thursday locally, returns the most recent Thursday (or next if opts.next).
 * @param {Date} [now]
 * @param {{timeZone?: string, prefer?: "today"|"nearest-past"|"nearest-next"}} [opts]
 */
function scheduledThursdayDate(now = new Date(), opts = {}) {
  const tz = resolveTimeZone(opts.timeZone);
  const parts = localParts(now, tz);
  if (parts.weekday === 4) return parts.dateStr;

  // Shift to nearest past Thursday by default (preparation on Thu morning uses today).
  const prefer = opts.prefer || "nearest-past";
  let delta;
  if (prefer === "nearest-next") {
    delta = (4 - parts.weekday + 7) % 7 || 7;
  } else {
    delta = -((parts.weekday - 4 + 7) % 7);
  }
  return shiftDateStr(parts.dateStr, delta);
}

function shiftDateStr(dateStr, days) {
  const ms = parseDateOnly(dateStr) + days * 86400000;
  const d = new Date(ms);
  return d.toISOString().slice(0, 10);
}

module.exports = {
  ANCHOR_THURSDAY,
  ROTATION_VERSION,
  thursdayIndexFromAnchor,
  resolveCountryForThursday,
  scheduledThursdayDate,
  shiftDateStr,
  parseDateOnly,
};
