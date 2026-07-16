"use strict";

const { GENERATOR_CATEGORIES } = require("../generator");
const { STREAMS } = require("./constants");
const { ValidationError, isNonEmptyString } = require("./validation");
const {
  resolveEditorialContext,
  EditorialResolutionError,
  EditorialValidationError,
  NeedsGroundingError,
  PROFILE_LABELS,
  OUTPUT_SURFACES,
  describeScheduleResolution,
} = require("../editorial");

/**
 * Error thrown when generation is requested but no PostGenerator is configured.
 */
class GenerationUnavailableError extends Error {
  constructor(message = "Generation service unavailable") {
    super(message);
    this.name = "GenerationUnavailableError";
    this.statusCode = 503;
  }
}

/**
 * Publishing Generation Service (v0.4) — OROK editorial system.
 *
 * Flow:
 *   schedule/category → resolve editorial profile → OrokPromptBuilder
 *   → PostGenerator → validate → draft → review queue
 *
 * No publishing generation request may proceed without a resolved profile.
 */
class PublishingGenerationService {
  /**
   * @param {{
   *   publishingService: import("./service").PublishingService,
   *   postGenerator?: { generatePosts: Function },
   * }} deps
   */
  constructor(deps) {
    if (!deps || !deps.publishingService) {
      throw new Error("PublishingGenerationService requires publishingService");
    }
    this.publishingService = deps.publishingService;
    this.postGenerator = deps.postGenerator || null;
  }

  isAvailable() {
    return Boolean(
      this.postGenerator && typeof this.postGenerator.generatePosts === "function"
    );
  }

  /**
   * Resolve editorial metadata for UI without generating.
   * @param {object} body
   */
  resolveEditorial(body = {}) {
    const context = resolveEditorialContext({
      idea: body.idea || body.topic,
      topic: body.topic || body.idea,
      category: body.category,
      stream: body.stream,
      surface: body.surface,
      scheduledFor: body.scheduledFor || body.plannedDate,
      grounding: body.grounding,
      profile: body.profile || body.editorialProfile,
    });
    return {
      editorialProfile: context.profile.id,
      editorialProfileLabel: context.profile.label,
      surface: context.surface,
      stream: context.stream,
      category: context.category,
      scheduledFor: context.scheduledFor,
      topic: context.topic,
      scheduleNote: describeScheduleResolution(context.scheduleMeta),
      requiresGrounding: context.profile.requiresGrounding,
    };
  }

  /**
   * Preview candidates — requires resolved OROK editorial profile.
   */
  async preview(body = {}) {
    this._assertGenerator();

    let context;
    try {
      context = await this._resolveContext(body);
    } catch (err) {
      throw mapEditorialError(err);
    }

    const result = await this.postGenerator.generatePosts({
      editorialContext: context,
      idea: context.topic,
      topic: context.topic,
      category: context.category,
      stream: context.stream,
      surface: context.surface,
      grounding: context.grounding,
      weeklyPosts: context.weeklyPosts,
      voiceProfile: context.voiceProfile,
      recentContext: context.recentContext,
    });

    const candidates = Array.isArray(result.posts)
      ? result.posts.filter(Boolean)
      : [];
    if (!candidates.length) {
      throw new ValidationError("Generation produced no posts", [
        "the generator returned no usable post candidates",
      ]);
    }

    return {
      candidates,
      category: context.category,
      idea: context.topic,
      topic: context.topic,
      editorialProfile: context.profile.id,
      editorialProfileLabel: context.profile.label,
      surface: context.surface,
      scheduleNote: describeScheduleResolution(context.scheduleMeta),
      validationStatus:
        (result.editorial && result.editorial.validationStatus) || "passed",
      profiles: PROFILE_LABELS,
      surfaces: OUTPUT_SURFACES,
    };
  }

  /**
   * Create a validated draft and place it into the review queue by default.
   */
  async generateDraft(body = {}) {
    const stream = body.stream;
    const plannedDate = body.plannedDate || body.scheduledFor;
    const errors = [];

    if (!STREAMS.includes(stream)) {
      errors.push(`stream must be one of: ${STREAMS.join(", ")}`);
    }
    if (!isNonEmptyString(plannedDate)) {
      errors.push("plannedDate is required");
    }
    if (errors.length) throw new ValidationError("Invalid generation request", errors);

    const topic = isNonEmptyString(body.topic)
      ? body.topic.trim()
      : isNonEmptyString(body.idea)
        ? body.idea.trim()
        : "";
    if (!topic) {
      throw new ValidationError("Invalid generation request", [
        "topic or idea is required",
      ]);
    }

    let candidates = null;
    let selectedIndex = null;
    let text = typeof body.text === "string" ? body.text : "";
    let editorialMeta = null;

    if (!isNonEmptyString(text)) {
      this._assertGenerator();
      let context;
      try {
        context = await this._resolveContext({
          ...body,
          topic,
          idea: body.idea || topic,
          plannedDate,
          scheduledFor: body.scheduledFor || plannedDate,
        });
      } catch (err) {
        throw mapEditorialError(err);
      }

      const result = await this.postGenerator.generatePosts({
        editorialContext: context,
        idea: context.topic,
        topic: context.topic,
        category: context.category,
        stream: context.stream,
        surface: context.surface,
        grounding: context.grounding,
        weeklyPosts: context.weeklyPosts,
        voiceProfile: context.voiceProfile,
        recentContext: context.recentContext,
      });

      candidates = Array.isArray(result.posts) ? result.posts.filter(Boolean) : [];
      if (!candidates.length) {
        throw new ValidationError("Generation produced no posts", [
          "the generator returned no usable post candidates",
        ]);
      }
      selectedIndex = Number.isInteger(body.selectedIndex) ? body.selectedIndex : 0;
      if (selectedIndex < 0 || selectedIndex >= candidates.length) {
        throw new ValidationError("Invalid generation request", [
          `selectedIndex must be between 0 and ${candidates.length - 1}`,
        ]);
      }
      text = candidates[selectedIndex];
      editorialMeta = result.editorial || {
        editorialProfile: context.profile.id,
        surface: context.surface,
        validationStatus: "passed",
      };
    } else {
      // Selecting a pre-generated candidate — still resolve profile for metadata
      try {
        const context = await this._resolveContext({
          ...body,
          topic,
          plannedDate,
          scheduledFor: body.scheduledFor || plannedDate,
        });
        editorialMeta = {
          editorialProfile: context.profile.id,
          editorialProfileLabel: context.profile.label,
          surface: context.surface,
          validationStatus: "passed",
        };
      } catch (_err) {
        editorialMeta = null;
      }
    }

    const category = isNonEmptyString(body.category)
      ? body.category.trim()
      : editorialMeta && editorialMeta.editorialProfileLabel
        ? editorialMeta.editorialProfileLabel
        : undefined;

    const createBody = {
      stream,
      plannedDate,
      topic,
      category,
      text,
      status: "draft",
      imageRequired: body.imageRequired === true,
      imageBrief: isNonEmptyString(body.imageBrief)
        ? body.imageBrief.trim()
        : undefined,
      notes: isNonEmptyString(body.notes) ? body.notes.trim() : undefined,
      similarityKeys: body.similarityKeys,
    };

    if (Number.isInteger(body.seriesNumber)) {
      createBody.seriesNumber = body.seriesNumber;
    }

    const { item, duplicateAdvisory } =
      await this.publishingService.createDraft(createBody);

    const placeInReview = body.placeInReview !== false;
    let finalItem = item;
    if (placeInReview) {
      finalItem = await this.publishingService.submit(item.id);
    }

    if (finalItem.status === "approved" || finalItem.status === "published") {
      throw new Error(
        "Safety violation: generation attempted to produce an approved/published item"
      );
    }

    return {
      item: finalItem,
      candidates,
      selectedIndex,
      duplicateAdvisory,
      editorialProfile: editorialMeta && editorialMeta.editorialProfile,
      editorialProfileLabel: editorialMeta && editorialMeta.editorialProfileLabel,
      surface: editorialMeta && editorialMeta.surface,
      validationStatus: editorialMeta && editorialMeta.validationStatus,
    };
  }

  async _resolveContext(body) {
    const recentContext = await this._loadRecentContext();
    return resolveEditorialContext({
      idea: body.idea || body.topic,
      topic: body.topic || body.idea,
      category: body.category,
      stream: body.stream,
      surface: body.surface || "family-message",
      scheduledFor: body.scheduledFor || body.plannedDate,
      plannedDate: body.plannedDate,
      grounding: body.grounding,
      weeklyPosts: body.weeklyPosts,
      voiceProfile: body.voiceProfile,
      recentContext,
      profile: body.profile || body.editorialProfile,
    });
  }

  async _loadRecentContext() {
    try {
      const items = await this.publishingService.listItems({});
      return items.slice(0, 20).map((i) => ({
        stream: i.stream,
        category: i.category,
        topic: i.topic,
        text: i.text,
        status: i.status,
      }));
    } catch (_err) {
      return [];
    }
  }

  _assertGenerator() {
    if (!this.isAvailable()) {
      throw new GenerationUnavailableError(
        "Generation service unavailable — OpenAI generator is not configured"
      );
    }
  }
}

function mapEditorialError(err) {
  if (
    err instanceof EditorialResolutionError ||
    err instanceof EditorialValidationError ||
    err instanceof NeedsGroundingError
  ) {
    const mapped = new ValidationError(err.message, err.errors || err.missing || []);
    mapped.code = err.code || err.name;
    mapped.statusCode = err.statusCode || 400;
    return mapped;
  }
  return err;
}

module.exports = {
  PublishingGenerationService,
  GenerationUnavailableError,
};
