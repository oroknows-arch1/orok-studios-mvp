"use strict";

/** @type {import("../types").EditorialProfile} */
module.exports = {
  id: "masters-of-yesterday",
  label: "Masters of Yesterday",
  purpose:
    "Focus on a historical person, group, movement, practice, invention, or achievement with concrete factual detail.",
  must: [
    "focus on a historical person, group, movement, practice, invention, or achievement",
    "include at least three concrete factual details",
    "establish the person or subject clearly",
    "explain what they actually did",
    "show the structure, discipline, method, sacrifice, or insight behind the achievement",
    "connect the historical example to a practical present-day pattern",
  ],
  mustNot: [
    "hero worship",
    "generic biography summaries",
    "textbook tone",
    "invented historical details",
  ],
  lengthTarget: { min: 320, max: 420 },
  requiresGrounding: true,
  groundingKeys: ["subject", "facts"],
  reasoningNotes:
    "Historical observation with facts → pattern of method/discipline → coffee-break present-day signal.",
};
