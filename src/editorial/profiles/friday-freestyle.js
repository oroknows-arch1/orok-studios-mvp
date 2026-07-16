"use strict";

/** @type {import("../types").EditorialProfile} */
module.exports = {
  id: "friday-freestyle",
  label: "Friday Freestyle",
  purpose:
    "Allow a lighter or more personal observation while still preserving the OROK voice.",
  must: [
    "use a light or conversational tone without losing groundedness",
    "preserve the OROK voice",
    "avoid engagement bait",
    "end with a complete thought",
  ],
  mustNot: [
    "generic engagement bait",
    "influencer tone",
    "empty weekend slogans",
  ],
  lengthTarget: { min: 260, max: 340 },
  requiresGrounding: false,
  groundingKeys: [],
  reasoningNotes:
    "Personal or lighter observation → small pattern → coffee-break signal.",
};
