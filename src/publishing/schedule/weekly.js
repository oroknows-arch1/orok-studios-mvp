"use strict";

/**
 * Weekly OROK editorial calendar (capability of the original app).
 * Maps ISO weekday → morning category (+ notes for special flows).
 */

const WEEKDAY_MORNING = Object.freeze({
  1: Object.freeze({
    id: "motivation-monday",
    label: "Motivation Monday",
    stream: "orok-morning",
    requiresTheme: true,
    notes: "Requires a user theme before final copy.",
  }),
  2: Object.freeze({
    id: "masters-of-today",
    label: "Masters of Today",
    stream: "orok-morning",
    requiresTheme: true,
    tributeManualImage: true,
    includeDadJoke: true,
    notes:
      "Includes tribute and Dad Joke Tuesday. Tribute image is manual upload — do not auto-generate a likeness.",
  }),
  3: Object.freeze({
    id: "words-of-wisdom",
    label: "Words of Wisdom",
    stream: "orok-morning",
    requiresTheme: true,
    notes: "Requires a user theme.",
  }),
  4: Object.freeze({
    id: "masters-of-yesterday",
    label: "Masters of Yesterday",
    stream: "orok-morning",
    requiresTheme: false,
    culturalSeries: true,
    includeCookIslandsMaori: true,
    notes:
      "Cultural series with four-country rotation plus Thursday Lingo (Learn Cook Islands Māori).",
  }),
  5: Object.freeze({
    id: "weekly-reflection",
    label: "Weekly Reflection",
    stream: "orok-morning",
    requiresWeeklyContext: true,
    fridayRecap: true,
    notes:
      "Friday recap/reflection — connect the week’s ideas into one lesson (not a day-by-day list).",
  }),
  6: Object.freeze({
    id: "saturday-mixed",
    label: "Saturday Mixed",
    stream: "saturday-mixed",
    mixed: true,
    notes: "Choose from established OROK categories; avoid recent repetition.",
  }),
  7: Object.freeze({
    id: "sunday-long-game",
    label: "The Long Game",
    stream: "sunday-long-game",
    longGame: true,
    notes: "Weekly Intelligence Brief with 2–5 clickable sources.",
  }),
});

const COFFEE_BREAK = Object.freeze({
  id: "coffee-break-build",
  label: "Coffee Break Build",
  stream: "coffee-break-build",
  notes: "Evening build; numbering continues from latest published/approved reservation rules.",
});

/** Categories allowed in Saturday mixed selection. */
const SATURDAY_MIX_POOL = Object.freeze([
  "Motivation Monday",
  "Masters of Today",
  "Words of Wisdom",
  "Masters of Yesterday",
  "Weekly Reflection",
  "Coffee Break Build",
]);

/**
 * @param {number} weekday ISO 1–7
 */
function morningForWeekday(weekday) {
  return WEEKDAY_MORNING[weekday] || null;
}

/**
 * Generator category label used by legacy /generate route.
 * Maps Words of Wisdom → Wisdom Wednesday for prompt compatibility,
 * Weekly Reflection → Friday Recap prompt family (reflection rules differ in prep notes).
 */
function generatorCategoryFor(label) {
  if (label === "Words of Wisdom") return "Wisdom Wednesday";
  if (label === "Weekly Reflection") return "Friday Recap";
  if (label === "The Long Game") return "Sunday Long Game";
  if (label === "Saturday Mixed") return "Friday Freestyle";
  if (label === "Coffee Break Build") return "Friday Freestyle";
  return label;
}

module.exports = {
  WEEKDAY_MORNING,
  COFFEE_BREAK,
  SATURDAY_MIX_POOL,
  morningForWeekday,
  generatorCategoryFor,
};
