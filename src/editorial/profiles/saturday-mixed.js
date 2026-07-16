"use strict";

/** @type {import("../types").EditorialProfile} */
module.exports = {
  id: "saturday-mixed",
  label: "Saturday Mixed Pack",
  purpose:
    "Saturday may use any approved OROK category tone; default to a grounded observational post that preserves core voice.",
  must: [
    "preserve the OROK core voice",
    "remain observational and grounded",
    "end with a complete coffee-break signal",
  ],
  mustNot: [
    "generic engagement bait",
    "empty weekend slogans",
  ],
  lengthTarget: { min: 260, max: 400 },
  requiresGrounding: false,
  groundingKeys: [],
  reasoningNotes:
    "Saturday observation → pattern → coffee-break signal. Prefer an explicit category when the queue schedules one.",
};
