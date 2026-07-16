"use strict";

/** @type {import("../types").EditorialProfile} */
module.exports = {
  id: "masters-of-today",
  label: "Masters of Today",
  purpose:
    "Focus on a living or contemporary person, team, builder, thinker, craftsperson, organisation, or movement and their real contribution.",
  must: [
    "focus on a living or contemporary person, team, builder, thinker, craftsperson, organisation, or movement",
    "include at least three concrete factual details from grounding or known facts",
    "explain what they are building, solving, studying, protecting, or changing",
    "focus on process and contribution rather than fame",
    "connect their work to a useful present-day pattern",
  ],
  mustNot: [
    "promotional language",
    "unsupported claims",
    "invented biographical details",
    "personality/aura/energy commentary instead of facts",
  ],
  lengthTarget: { min: 320, max: 420 },
  requiresGrounding: true,
  groundingKeys: ["subject", "facts"],
  reasoningNotes:
    "Identify the person with facts → show the method/contribution pattern → coffee-break signal for ordinary work.",
};
