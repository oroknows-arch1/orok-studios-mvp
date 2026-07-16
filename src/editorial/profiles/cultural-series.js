"use strict";

/** @type {import("../types").EditorialProfile} */
module.exports = {
  id: "cultural-series",
  label: "Cultural Series",
  purpose:
    "Identify a real people, community, culture, tradition, place, practice, historical figure, or cultural system with research-grounded detail and present-day continuity.",
  must: [
    "identify a real people, community, culture, tradition, place, practice, historical figure, or cultural system",
    "contain meaningful factual detail from supplied grounding (at least three concrete details)",
    "explain practices through their environmental, social, historical, family, or survival context",
    "treat living cultures as living cultures, not relics",
    "use correct names, places, and relationships from grounding",
    "connect the factual material to a grounded present-day observation",
    "preserve cultural respect over entertainment value",
    "use research-grounded claims only",
  ],
  mustNot: [
    "exoticising, romanticising, stereotyping, or flattening the culture",
    "claiming ownership, identity, spirituality, or authority on behalf of the people discussed",
    "generic statements such as 'they lived in harmony with nature' unless supported by specific practices",
    "invented cultural details",
    "dramatic or romantic language",
    "generic 'culture of the day' summary tone",
  ],
  lengthTarget: { min: 320, max: 420 },
  requiresGrounding: true,
  groundingKeys: ["nation", "region", "practices", "continuity"],
  reasoningNotes:
    "Factual cultural observation → pattern of knowledge/practice/continuity → coffee-break signal that stays respectful and ordinary.",
};
