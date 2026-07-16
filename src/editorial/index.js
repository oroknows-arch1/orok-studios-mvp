"use strict";

const {
  EDITORIAL_PROFILE_IDS,
  OUTPUT_SURFACES,
  CATEGORY_TO_PROFILE,
  PROFILE_LABELS,
  EditorialResolutionError,
  EditorialValidationError,
  NeedsGroundingError,
} = require("./types");
const { CORE_VOICE, REASONING_LENS, GENERIC_SELF_HELP_PHRASES } = require("./voice");
const {
  FAMILY_GREETING,
  FAMILY_SIGNOFF,
  SURFACE_RULES,
  getSurfaceRules,
  wrapFamilyMessage,
  renderSurfaceBlock,
} = require("./formatting");
const {
  WEEKDAY_DEFAULT_PROFILE,
  STREAM_DEFAULT_PROFILE,
  isoWeekday,
  resolveEditorialProfile,
  describeScheduleResolution,
} = require("./schedule");
const { PROFILES, getProfile } = require("./profiles");
const { OrokPromptBuilder } = require("./prompt-builder");
const { validateCandidates } = require("./validation");
const {
  flattenGroundingDetails,
  assertGrounding,
  renderGroundingBlock,
} = require("./grounding");
const { listExamples, ARCHIVE_IMPORT_PATH, ARCHIVE_IMPORT_NOTES } = require("./examples");

/**
 * Resolve a full editorial context or throw — never fall back to generic generation.
 *
 * @param {object} input
 * @returns {import("./types").ResolvedEditorialContext & { scheduleMeta: object }}
 */
function resolveEditorialContext(input = {}) {
  const scheduleMeta = resolveEditorialProfile({
    category: input.category,
    stream: input.stream,
    scheduledFor: input.scheduledFor || input.plannedDate,
    profile: input.profile || input.editorialProfile,
  });

  const profile = getProfile(scheduleMeta.profileId);

  let surface = input.surface || "family-message";
  if (!OUTPUT_SURFACES.includes(surface)) {
    throw new EditorialResolutionError("Unknown output surface", [
      `surface must be one of: ${OUTPUT_SURFACES.join(", ")}`,
    ]);
  }

  const topic =
    (typeof input.topic === "string" && input.topic.trim()) ||
    (typeof input.idea === "string" && input.idea.trim()) ||
    "";
  if (!topic) {
    throw new EditorialResolutionError("Topic required", [
      "topic or idea is required for OROK generation",
    ]);
  }

  assertGrounding(profile, input.grounding);

  const examples = listExamples({
    profileId: profile.id,
    surface,
    limit: 2,
  });

  return {
    profileId: profile.id,
    profile,
    surface,
    stream: input.stream || null,
    category: input.category || profile.label,
    topic,
    scheduledFor: input.scheduledFor || input.plannedDate || null,
    grounding: input.grounding || null,
    recentContext: Array.isArray(input.recentContext) ? input.recentContext : [],
    examples,
    weeklyPosts: typeof input.weeklyPosts === "string" ? input.weeklyPosts : null,
    voiceProfile: input.voiceProfile || null,
    scheduleMeta: {
      profileId: scheduleMeta.profileId,
      source: scheduleMeta.source,
      weekday: scheduleMeta.weekday,
    },
  };
}

/**
 * Build prompts from a resolved context (or resolve from input).
 * @param {object} inputOrContext
 */
function buildOrokPrompt(inputOrContext = {}) {
  const context =
    inputOrContext.profile && inputOrContext.profileId
      ? inputOrContext
      : resolveEditorialContext(inputOrContext);
  const builder = new OrokPromptBuilder({
    ...context,
    candidateCount: inputOrContext.candidateCount || 3,
    debug: inputOrContext.debug === true,
  });
  return builder.build();
}

module.exports = {
  // types / errors
  EDITORIAL_PROFILE_IDS,
  OUTPUT_SURFACES,
  CATEGORY_TO_PROFILE,
  PROFILE_LABELS,
  EditorialResolutionError,
  EditorialValidationError,
  NeedsGroundingError,
  // voice / formatting
  CORE_VOICE,
  REASONING_LENS,
  GENERIC_SELF_HELP_PHRASES,
  FAMILY_GREETING,
  FAMILY_SIGNOFF,
  SURFACE_RULES,
  getSurfaceRules,
  wrapFamilyMessage,
  renderSurfaceBlock,
  // schedule / profiles
  WEEKDAY_DEFAULT_PROFILE,
  STREAM_DEFAULT_PROFILE,
  isoWeekday,
  resolveEditorialProfile,
  describeScheduleResolution,
  PROFILES,
  getProfile,
  // builder / validation / grounding / examples
  OrokPromptBuilder,
  buildOrokPrompt,
  resolveEditorialContext,
  validateCandidates,
  flattenGroundingDetails,
  assertGrounding,
  renderGroundingBlock,
  listExamples,
  ARCHIVE_IMPORT_PATH,
  ARCHIVE_IMPORT_NOTES,
};
