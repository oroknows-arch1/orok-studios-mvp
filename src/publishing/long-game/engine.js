"use strict";

const { runIntelligence } = require("./intelligence");
const { formatLongGamePost, formatLongGameXPost } = require("./format");
const { assertLongGameSources, streamAllowsSources } = require("./sources");
const { listCategories } = require("./categories");
const { ValidationError } = require("../validation");

/**
 * Long Game Intelligence Engine — Weekly Intelligence Brief generator.
 *
 * Responsibilities:
 * - gather current weekly macro developments
 * - identify dominant patterns / remove noise
 * - identify one meaningful family takeaway
 * - generate one family text version + one X version
 * - attach supporting sources (2–5 clickable links)
 * - store everything in the publishing ledger via PublishingService
 */
class LongGameEngine {
  /**
   * @param {{ publishingService: import("../service").PublishingService }} deps
   */
  constructor(deps) {
    if (!deps || !deps.publishingService) {
      throw new Error("LongGameEngine requires publishingService");
    }
    this.publishingService = deps.publishingService;
  }

  /** @returns {readonly string[]} */
  categories() {
    return listCategories();
  }

  /**
   * Run the intelligence process without persisting.
   * @param {object} input
   */
  analyze(input = {}) {
    return runIntelligence(input);
  }

  /**
   * Build formatted family + X posts from intelligence output.
   * Guarantees Sources footer with 2–5 valid links.
   * @param {object} input
   */
  generateBrief(input = {}) {
    const intel = runIntelligence(input);
    const sources = assertLongGameSources(intel.sources);

    const content = {
      title: intel.title,
      body: intel.body,
      familyLesson: intel.familyLesson,
      macroSignal: intel.macroSignal,
      dominantPattern: intel.dominantPattern,
      sources,
    };

    const familyText = formatLongGamePost(content);
    const xText = formatLongGameXPost({
      ...content,
      body: intel.bodyX || intel.body,
    });

    return {
      ...intel,
      sources,
      familyText,
      xText,
      content,
    };
  }

  /**
   * Generate a Weekly Intelligence Brief and store it in the publishing ledger
   * as a sunday-long-game draft (status idea|draft).
   *
   * @param {object} input
   * @param {{
   *   plannedDate?: string,
   *   status?: "idea"|"draft",
   *   notes?: string,
   *   surface?: "family"|"x",
   * }} [ledgerOpts]
   * @returns {Promise<{brief: object, item: object, duplicateAdvisory: object}>}
   */
  async generateAndStore(input = {}, ledgerOpts = {}) {
    const brief = this.generateBrief(input);
    const plannedDate =
      ledgerOpts.plannedDate ||
      input.weekOf ||
      new Date().toISOString().slice(0, 10);
    const surface = ledgerOpts.surface === "x" ? "x" : "family";
    const text = surface === "x" ? brief.xText : brief.familyText;

    const payload = {
      stream: "sunday-long-game",
      plannedDate,
      status: ledgerOpts.status === "idea" ? "idea" : "draft",
      topic: brief.title,
      category: "Sunday Long Game",
      dominantPattern: brief.dominantPattern,
      macroSignal: brief.macroSignal,
      familyLesson: brief.familyLesson,
      sources: brief.sources,
      text,
      imageRequired: false,
      notes:
        ledgerOpts.notes ||
        `Long Game Weekly Intelligence Brief. Themes: ${(brief.themes || []).join(", ") || "n/a"}. Surface: ${surface}.`,
      similarityKeys: {
        centralLesson: brief.familyLesson,
        opening: brief.title,
      },
    };

    // Defense: only sunday-long-game may carry sources.
    if (!streamAllowsSources(payload.stream)) {
      throw new ValidationError("Invalid stream for sources", [
        "only sunday-long-game may include source links",
      ]);
    }

    const { item, duplicateAdvisory } =
      await this.publishingService.createDraft(payload);

    return { brief, item, duplicateAdvisory };
  }
}

module.exports = { LongGameEngine };
