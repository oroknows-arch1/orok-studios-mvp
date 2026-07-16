"use strict";

const { GENERATOR_CATEGORIES } = require("../generator");
const { STREAMS } = require("./constants");
const { ValidationError, isNonEmptyString } = require("./validation");

/**
 * Error thrown when generation is requested but no PostGenerator is configured
 * (e.g. missing OPENAI_API_KEY wiring). Distinct from ValidationError so the
 * HTTP layer can return 503 rather than 400.
 */
class GenerationUnavailableError extends Error {
  constructor(message = "Generation service unavailable") {
    super(message);
    this.name = "GenerationUnavailableError";
    this.statusCode = 503;
  }
}

/**
 * Publishing Generation Service (v0.4).
 *
 * Flow:
 *   Publishing UI → Generation API → this service → PostGenerator interface
 *   → Validated PublishingItem draft → repository → Today's Queue
 *
 * Safety:
 *   - Creates only idea/draft items, then optionally submits to `review`.
 *   - NEVER auto-approves.
 *   - NEVER marks published.
 *   - NEVER calls X or any external publishing network.
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

  /** Whether a PostGenerator is wired and ready to call. */
  isAvailable() {
    return Boolean(this.postGenerator && typeof this.postGenerator.generatePosts === "function");
  }

  /**
   * Preview candidates without writing to the repository.
   * @param {object} body
   * @returns {Promise<{ candidates: string[], category: string, idea: string }>}
   */
  async preview(body = {}) {
    this._assertGenerator();
    const { idea, category, weeklyPosts, voiceProfile } = this._collectGenerationInput(body);
    const result = await this.postGenerator.generatePosts({
      idea,
      category,
      weeklyPosts,
      voiceProfile,
    });
    const candidates = Array.isArray(result.posts) ? result.posts.filter(Boolean) : [];
    if (!candidates.length) {
      throw new ValidationError("Generation produced no posts", [
        "the generator returned no usable post candidates",
      ]);
    }
    return { candidates, category, idea };
  }

  /**
   * Generate (or accept pre-selected text), create a validated draft, and place
   * it into the review queue (status `review`) by default.
   *
   * @param {object} body
   * @returns {Promise<{
   *   item: object,
   *   candidates: string[]|null,
   *   selectedIndex: number|null,
   *   duplicateAdvisory: object
   * }>}
   */
  async generateDraft(body = {}) {
    const stream = body.stream;
    const plannedDate = body.plannedDate;
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

    // If the caller already chose a candidate (from /generate/preview), persist
    // that text without a second OpenAI call. Otherwise call the generator.
    if (!isNonEmptyString(text)) {
      this._assertGenerator();
      const { idea, category, weeklyPosts, voiceProfile } =
        this._collectGenerationInput({ ...body, idea: body.idea || topic });
      const result = await this.postGenerator.generatePosts({
        idea,
        category,
        weeklyPosts,
        voiceProfile,
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
    }

    const category = isNonEmptyString(body.category)
      ? body.category.trim()
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

    // Default: place into the review queue. Never approve or publish.
    const placeInReview = body.placeInReview !== false;
    let finalItem = item;
    if (placeInReview) {
      finalItem = await this.publishingService.submit(item.id);
    }

    // Defense-in-depth: generation must never produce approved/published.
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
    };
  }

  _assertGenerator() {
    if (!this.isAvailable()) {
      throw new GenerationUnavailableError(
        "Generation service unavailable — OpenAI generator is not configured"
      );
    }
  }

  /**
   * @param {object} body
   * @returns {{ idea: string, category: string, weeklyPosts?: string, voiceProfile?: object }}
   */
  _collectGenerationInput(body) {
    const idea = isNonEmptyString(body.idea)
      ? body.idea.trim()
      : isNonEmptyString(body.topic)
        ? body.topic.trim()
        : "";
    const category = isNonEmptyString(body.category) ? body.category.trim() : "";
    const errors = [];
    if (!idea) errors.push("idea (or topic) is required for generation");
    if (!category) errors.push("category is required for generation");
    else if (!GENERATOR_CATEGORIES.includes(category)) {
      errors.push(
        `category must be one of: ${GENERATOR_CATEGORIES.join(", ")}`
      );
    }
    if (errors.length) throw new ValidationError("Invalid generation request", errors);

    return {
      idea,
      category,
      weeklyPosts:
        typeof body.weeklyPosts === "string" ? body.weeklyPosts : undefined,
      voiceProfile:
        body.voiceProfile && typeof body.voiceProfile === "object"
          ? body.voiceProfile
          : undefined,
    };
  }
}

module.exports = {
  PublishingGenerationService,
  GenerationUnavailableError,
};
