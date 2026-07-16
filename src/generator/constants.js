"use strict";

/**
 * Generator category labels shown in Create Post + Publishing UI.
 * Mapped to canonical editorial profiles via src/editorial.
 */
const GENERATOR_CATEGORIES = Object.freeze([
  "Motivation Monday",
  "Masters of Today",
  "Wisdom Wednesday",
  "Masters of Yesterday",
  "Cultural Series",
  "Friday Recap",
  "Friday Freestyle",
  "Coffee Break Build",
  "Long Game",
  "Saturday Mixed Pack",
]);

const GREETING = "Morning everyone 👋";
const SIGNOFF = "Enjoy the day love you all c u this arvo😘";
const MAX_CHARS = 500;

module.exports = {
  GENERATOR_CATEGORIES,
  GREETING,
  SIGNOFF,
  MAX_CHARS,
};
