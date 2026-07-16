"use strict";

/** @type {import("../types").EditorialProfile} */
module.exports = {
  id: "motivation",
  label: "Motivation",
  purpose:
    "Begin with a real observation, tension, habit, or everyday situation and make motivation practical.",
  must: [
    "begin with a real observation, tension, habit, or everyday situation",
    "make motivation practical",
    "focus on behaviour, routine, discipline, responsibility, repetition, preparation, or decision-making",
    "end with a grounded signal rather than a slogan",
  ],
  mustNot: [
    "commands such as 'believe in yourself' or 'never give up'",
    "generic self-help",
    "exaggerated emotional language",
    "slogans or empty inspiration",
  ],
  lengthTarget: { min: 260, max: 360 },
  requiresGrounding: false,
  groundingKeys: [],
  reasoningNotes:
    "Observation of everyday tension → pattern of behaviour/discipline → coffee-break signal the reader can act on today.",
};
