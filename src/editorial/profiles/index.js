"use strict";

const motivation = require("./motivation");
const mastersOfToday = require("./masters-of-today");
const wisdom = require("./wisdom");
const mastersOfYesterday = require("./masters-of-yesterday");
const culturalSeries = require("./cultural-series");
const fridayRecap = require("./friday-recap");
const fridayFreestyle = require("./friday-freestyle");
const coffeeBreakBuild = require("./coffee-break-build");
const longGame = require("./long-game");
const saturdayMixed = require("./saturday-mixed");
const { EditorialResolutionError } = require("../types");

/** @type {Readonly<Record<string, import("../types").EditorialProfile>>} */
const PROFILES = Object.freeze({
  motivation,
  "masters-of-today": mastersOfToday,
  wisdom,
  "masters-of-yesterday": mastersOfYesterday,
  "cultural-series": culturalSeries,
  "friday-recap": fridayRecap,
  "friday-freestyle": fridayFreestyle,
  "coffee-break-build": coffeeBreakBuild,
  "long-game": longGame,
  "saturday-mixed": saturdayMixed,
});

/**
 * @param {string} profileId
 * @returns {import("../types").EditorialProfile}
 */
function getProfile(profileId) {
  const profile = PROFILES[profileId];
  if (!profile) {
    throw new EditorialResolutionError("Editorial profile not found", [
      `no canonical OROK profile for "${profileId}"`,
      "refusing to generate generic content",
    ]);
  }
  return profile;
}

module.exports = { PROFILES, getProfile };
