"use strict";

/** @type {import("../types").EditorialProfile} */
module.exports = {
  id: "wisdom",
  label: "Wisdom",
  purpose:
    "Centre on a durable idea, behaviour, proverb, lesson, principle, or pattern and show how it appears in ordinary life.",
  must: [
    "centre on a durable idea, behaviour, proverb, lesson, principle, or pattern",
    "explain the idea rather than merely quoting it",
    "show how it appears in ordinary life",
    "remain calm and observational",
    "finish with a useful thought that can stay with the reader during the day",
  ],
  mustNot: [
    "sound like a quote page",
    "present opinion as universal truth",
    "generic inspiration",
  ],
  lengthTarget: { min: 260, max: 360 },
  requiresGrounding: false,
  groundingKeys: [],
  reasoningNotes:
    "Name the idea through observation → reveal the pattern underneath → coffee-break signal for the day.",
};
