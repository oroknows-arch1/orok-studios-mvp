"use strict";

const {
  DEFAULT_WEEKLY_CATEGORIES,
  listCategories,
  registerCategory,
  resetCategories,
  isKnownCategory,
} = require("./categories");
const {
  MIN_SOURCES,
  MAX_SOURCES,
  PRIMARY_PUBLISHERS,
  SOURCE_FREE_STREAMS,
  SOURCE_FREE_POST_LABELS,
  SourceValidationError,
  isValidHttpUrl,
  normalizeSource,
  collectSourceErrors,
  assertLongGameSources,
  selectSources,
  formatSourcesFooter,
  streamAllowsSources,
  postLabelAllowsSources,
} = require("./sources");
const {
  formatLongGamePost,
  formatLongGameXPost,
  textHasSourcesFooter,
  parseLongGameFields,
} = require("./format");
const {
  FALLBACK_PRIMARY_SOURCES,
  collectDevelopments,
  identifyThemes,
  determineDominantPattern,
  familyTakeaway,
  gatherSources,
  runIntelligence,
} = require("./intelligence");
const { LongGameEngine } = require("./engine");

module.exports = {
  // Engine
  LongGameEngine,
  // Categories
  DEFAULT_WEEKLY_CATEGORIES,
  listCategories,
  registerCategory,
  resetCategories,
  isKnownCategory,
  // Sources
  MIN_SOURCES,
  MAX_SOURCES,
  PRIMARY_PUBLISHERS,
  SOURCE_FREE_STREAMS,
  SOURCE_FREE_POST_LABELS,
  SourceValidationError,
  isValidHttpUrl,
  normalizeSource,
  collectSourceErrors,
  assertLongGameSources,
  selectSources,
  formatSourcesFooter,
  streamAllowsSources,
  postLabelAllowsSources,
  // Format
  formatLongGamePost,
  formatLongGameXPost,
  textHasSourcesFooter,
  parseLongGameFields,
  // Intelligence
  FALLBACK_PRIMARY_SOURCES,
  collectDevelopments,
  identifyThemes,
  determineDominantPattern,
  familyTakeaway,
  gatherSources,
  runIntelligence,
};
