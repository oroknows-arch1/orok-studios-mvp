"use strict";

/** @type {import("../types").EditorialProfile} */
module.exports = {
  id: "friday-recap",
  label: "Friday Recap",
  purpose:
    "Reflect on the week, connect two or more earlier signals, or revisit a lesson from a different angle while preserving OROK voice.",
  must: [
    "reflect on the week or connect two or more signals where weekly material is available",
    "preserve the OROK voice",
    "remain grounded and human",
    "end with a complete thought",
  ],
  mustNot: [
    "generic engagement bait",
    "listing days one by one unless necessary",
    "empty wrap-up slogans",
  ],
  lengthTarget: { min: 320, max: 420 },
  requiresGrounding: false,
  groundingKeys: [],
  reasoningNotes:
    "Week's observations → shared pattern → coffee-break weekend signal.",
};
