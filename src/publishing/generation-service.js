"use strict";

const { GENERATOR_CATEGORIES } = require("../generator");
const { STREAMS } = require("./constants");
const { ValidationError, isNonEmptyString } = require("./validation");
const {
  createUsageRecord,
  toPublicUsage,
  estimateCostUsd,
} = require("./costs");

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
 * Publishing Generation Service (v0.4) + Cost Ledger integration (v0.1).
 *
 * Flow:
 *   Publishing UI → Generation API → this service → PostGenerator interface
 *   → usage metadata → Cost Ledger (observational) → Validated draft → review
 *
 * The cost ledger never gates generation, approval, or publishing.
 */
class PublishingGenerationService {
  /**
   * @param {{
   *   publishingService: import("./service").PublishingService,
   *   postGenerator?: { generatePosts: Function },
   *   costRepository?: import("./costs/repository-interface").CostLedgerRepository|null,
   *   logger?: (msg: string, meta?: object) => void,
   * }} deps
   */
  constructor(deps) {
    if (!deps || !deps.publishingService) {
      throw new Error("PublishingGenerationService requires publishingService");
    }
    this.publishingService = deps.publishingService;
    this.postGenerator = deps.postGenerator || null;
    this.costRepository = deps.costRepository || null;
    this.logger = deps.logger || defaultCostLogger;
  }

  /** Whether a PostGenerator is wired and ready to call. */
  isAvailable() {
    return Boolean(this.postGenerator && typeof this.postGenerator.generatePosts === "function");
  }

  /**
   * Preview candidates without writing a publishing item.
   * Creates one cost ledger record (status `generated`) per OpenAI request.
   *
   * @param {object} body
   * @returns {Promise<object>}
   */
  async preview(body = {}) {
    this._assertGenerator();
    const { idea, category, weeklyPosts, voiceProfile } =
      this._collectGenerationInput(body);
    const stream = STREAMS.includes(body.stream) ? body.stream : null;

    // Optional: mark a prior preview generation as discarded when regenerating.
    if (isNonEmptyString(body.discardGenerationId)) {
      await this._safeDiscard(body.discardGenerationId.trim());
    }

    let result;
    try {
      result = await this.postGenerator.generatePosts({
        idea,
        category,
        weeklyPosts,
        voiceProfile,
      });
    } catch (err) {
      await this._safeRecordFailure({
        stream,
        category,
        model: null,
        error: err,
      });
      throw err;
    }

    const candidates = Array.isArray(result.posts)
      ? result.posts.filter(Boolean)
      : [];
    if (!candidates.length) {
      throw new ValidationError("Generation produced no posts", [
        "the generator returned no usable post candidates",
      ]);
    }

    const ledger = await this._safeCreateGeneratedRecord({
      stream,
      category,
      usage: result.usage || null,
    });

    return {
      candidates,
      category,
      idea,
      generationId: ledger.record ? ledger.record.generationId : null,
      usage: ledger.record ? toPublicUsage(ledger.record) : publicUsageFromGenerator(result.usage),
      costTrackingUnavailable: ledger.unavailable === true,
    };
  }

  /**
   * Generate (or accept pre-selected text), create a validated draft, and place
   * it into the review queue (status `review`) by default.
   *
   * When `generationId` + `text` are supplied (post-preview selection), no new
   * OpenAI call and no new cost record are created — the existing ledger row is
   * attached to the publishing item and marked `accepted`.
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
    let generationId = isNonEmptyString(body.generationId)
      ? body.generationId.trim()
      : null;
    let usage = null;
    let costTrackingUnavailable = false;
    let createdLedgerThisRequest = false;

    // If the caller already chose a candidate (from /generate/preview), persist
    // that text without a second OpenAI call. Otherwise call the generator.
    if (!isNonEmptyString(text)) {
      this._assertGenerator();
      const { idea, category, weeklyPosts, voiceProfile } =
        this._collectGenerationInput({ ...body, idea: body.idea || topic });

      let result;
      try {
        result = await this.postGenerator.generatePosts({
          idea,
          category,
          weeklyPosts,
          voiceProfile,
        });
      } catch (err) {
        await this._safeRecordFailure({
          stream,
          category,
          model: null,
          error: err,
        });
        throw err;
      }

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
      usage = result.usage || null;

      const ledger = await this._safeCreateGeneratedRecord({
        stream,
        category,
        usage,
      });
      createdLedgerThisRequest = true;
      if (ledger.record) generationId = ledger.record.generationId;
      if (ledger.unavailable) costTrackingUnavailable = true;
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

    // Attach + accept existing (or just-created) generation cost record.
    // Selecting a candidate / queuing must NOT create an additional OpenAI cost row.
    if (generationId) {
      const accepted = await this._safeAccept(generationId, finalItem.id);
      if (accepted.unavailable) costTrackingUnavailable = true;
      if (accepted.record) usage = toPublicUsage(accepted.record);
    }

    return {
      item: finalItem,
      candidates,
      selectedIndex,
      duplicateAdvisory,
      generationId,
      usage: usage
        ? usage.generationId
          ? toPublicUsage(usage)
          : publicUsageFromGenerator(usage)
        : null,
      costTrackingUnavailable,
      // True only when this request itself performed a billed OpenAI call.
      generationRequestPerformed: createdLedgerThisRequest,
    };
  }

  /**
   * Explicitly discard a prior generation (e.g. user abandoned candidates).
   * @param {string} generationId
   */
  async discardGeneration(generationId) {
    if (!isNonEmptyString(generationId)) {
      throw new ValidationError("Invalid discard request", [
        "generationId is required",
      ]);
    }
    if (!this.costRepository) {
      throw new GenerationUnavailableError("Cost ledger unavailable");
    }
    const updated = await this.costRepository.markDiscarded(generationId.trim());
    if (!updated) {
      throw new ValidationError("Unknown generation", [
        "generationId was not found in the cost ledger",
      ]);
    }
    return { record: updated };
  }

  async getCostSummary(range = {}) {
    if (!this.costRepository) {
      return emptySummary();
    }
    return this.costRepository.aggregateSummary(range);
  }

  async listRecentCosts(opts = {}) {
    if (!this.costRepository) return [];
    return this.costRepository.listRecent(opts);
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

  async _safeCreateGeneratedRecord({ stream, category, usage }) {
    if (!this.costRepository) {
      return { record: null, unavailable: true };
    }
    try {
      const record = createUsageRecord({
        stream,
        category,
        status: "generated",
        usage: usage || undefined,
        model: usage && usage.model,
        inputTokens: usage && usage.inputTokens,
        outputTokens: usage && usage.outputTokens,
        totalTokens: usage && usage.totalTokens,
        estimatedCostUsd: usage ? usage.estimatedCostUsd : undefined,
        provider: (usage && usage.provider) || "openai",
      });
      const saved = await this.costRepository.create(record);
      return { record: saved, unavailable: false };
    } catch (err) {
      this.logger("COST_LEDGER_WARNING: failed to persist generation cost record", {
        event: "cost_ledger_persist_failed",
        phase: "create",
        message: err && err.message ? err.message : "unknown",
      });
      return { record: null, unavailable: true };
    }
  }

  async _safeAccept(generationId, publishingItemId) {
    if (!this.costRepository) {
      return { record: null, unavailable: true };
    }
    try {
      await this.costRepository.attachPublishingItem(generationId, publishingItemId);
      const record = await this.costRepository.markAccepted(generationId);
      return { record, unavailable: false };
    } catch (err) {
      this.logger("COST_LEDGER_WARNING: failed to accept generation cost record", {
        event: "cost_ledger_persist_failed",
        phase: "accept",
        generationId,
        message: err && err.message ? err.message : "unknown",
      });
      return { record: null, unavailable: true };
    }
  }

  async _safeDiscard(generationId) {
    if (!this.costRepository) return;
    try {
      await this.costRepository.markDiscarded(generationId);
    } catch (err) {
      this.logger("COST_LEDGER_WARNING: failed to discard generation cost record", {
        event: "cost_ledger_persist_failed",
        phase: "discard",
        generationId,
        message: err && err.message ? err.message : "unknown",
      });
    }
  }

  async _safeRecordFailure({ stream, category, model, error }) {
    if (!this.costRepository) return;
    try {
      const record = createUsageRecord({
        stream,
        category,
        model,
        status: "failed",
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
        estimatedCostUsd: null,
      });
      await this.costRepository.create(record);
    } catch (err) {
      this.logger("COST_LEDGER_WARNING: failed to persist failed-generation record", {
        event: "cost_ledger_persist_failed",
        phase: "failed",
        message: err && err.message ? err.message : "unknown",
        generationError: error && error.message ? error.message : "unknown",
      });
    }
  }
}

function publicUsageFromGenerator(usage) {
  if (!usage) return null;
  const estimated =
    usage.estimatedCostUsd !== undefined
      ? usage.estimatedCostUsd
      : estimateCostUsd(usage);
  return {
    model: usage.model || null,
    inputTokens: usage.inputTokens ?? null,
    outputTokens: usage.outputTokens ?? null,
    totalTokens: usage.totalTokens ?? null,
    estimatedCostUsd: estimated ?? null,
  };
}

function emptySummary() {
  return {
    totalGenerations: 0,
    totalAccepted: 0,
    totalDiscarded: 0,
    totalFailed: 0,
    totalEstimatedCostUsd: 0,
    averageCostPerGenerationUsd: null,
    averageCostPerAcceptedPostUsd: null,
    byStream: {},
    byModel: {},
  };
}

function defaultCostLogger(message, meta) {
  // Structured, secret-free warning. Never includes API keys or raw provider bodies.
  // eslint-disable-next-line no-console
  console.warn(message, meta && typeof meta === "object" ? JSON.stringify(meta) : "");
}

module.exports = {
  PublishingGenerationService,
  GenerationUnavailableError,
};
