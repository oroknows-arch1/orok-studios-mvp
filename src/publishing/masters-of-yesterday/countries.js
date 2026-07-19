"use strict";

/**
 * Permanent Masters of Yesterday country rotation (exactly one per Thursday).
 * Sequence: Indigenous Australia → Cook Islands → Aotearoa New Zealand → Peru → repeat.
 */
const COUNTRY_STREAMS = Object.freeze([
  Object.freeze({
    id: "indigenous-australia",
    label: "Indigenous Australia",
    hashtag: "Origins",
  }),
  Object.freeze({
    id: "cook-islands",
    label: "Cook Islands",
    hashtag: "CookIslands",
  }),
  Object.freeze({
    id: "aotearoa-new-zealand",
    label: "Aotearoa New Zealand",
    hashtag: "Aotearoa",
  }),
  Object.freeze({
    id: "peru",
    label: "Peru",
    hashtag: "Culture",
  }),
]);

const ROTATION_VERSION = "moy-v1";

/**
 * Fixed Thursday anchor (Australia/Sydney calendar date).
 * Elapsed scheduled Thursdays from this date drive modulo-4 country selection.
 * Missed/unpublished weeks do not change the calendar sequence.
 */
const ANCHOR_THURSDAY = "2026-01-01"; // Thursday in Australia/Sydney

module.exports = {
  COUNTRY_STREAMS,
  ROTATION_VERSION,
  ANCHOR_THURSDAY,
};
