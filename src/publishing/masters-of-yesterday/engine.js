"use strict";

const { resolveCountryForThursday, scheduledThursdayDate } = require("./rotation");
const { composeMastersOfYesterdayPost } = require("./editorial");
const { buildHeritageLensBrief } = require("./image-brief");
const { selectEpisode } = require("./podcast");
const { selectCulturalEntry, collectUsedEpisodeIds } = require("./select");
const { getEntryById } = require("./catalogue");

/**
 * Masters of Yesterday Cultural Series engine — Thursday morning capability.
 */
class MastersOfYesterdayEngine {
  /**
   * @param {{ publishingService: import("../service").PublishingService }} deps
   */
  constructor(deps) {
    if (!deps || !deps.publishingService) {
      throw new Error("MastersOfYesterdayEngine requires publishingService");
    }
    this.publishingService = deps.publishingService;
  }

  /**
   * Build a full Thursday edition without persisting.
   * @param {{ scheduledDate?: string, timeZone?: string, now?: Date }} [opts]
   */
  async buildEdition(opts = {}) {
    const scheduledDate =
      opts.scheduledDate ||
      scheduledThursdayDate(opts.now || new Date(), {
        timeZone: opts.timeZone,
        prefer: "today",
      });

    const rotation = resolveCountryForThursday(scheduledDate);
    const history = await this._moyHistory();
    const entry = selectCulturalEntry(rotation.countryStream.id, history);

    if (!entry) {
      return {
        ok: false,
        scheduledDate,
        rotation,
        reviewStatus: "Requires Review",
        reason: "No approved cultural catalogue entries for this country stream",
      };
    }

    const post = composeMastersOfYesterdayPost(entry, rotation.countryStream);
    const image = buildHeritageLensBrief(entry, rotation.countryStream);
    const usedEpisodes = collectUsedEpisodeIds(history);
    const lingo = selectEpisode({
      usedEpisodeIds: usedEpisodes,
      cycleKey: `lingo-${scheduledDate.slice(0, 4)}`,
    });

    const reviewFlags = [];
    if (post.reviewStatus === "Requires Review") reviewFlags.push("cultural content");
    if (image.requiresManualImageReview) reviewFlags.push("image brief");
    if (!lingo.ok || lingo.requiresReview) reviewFlags.push("Thursday Lingo");

    const seriesMeta = {
      category: "Masters of Yesterday",
      scheduledDate,
      countryStream: rotation.countryStream.id,
      countryStreamLabel: rotation.countryStream.label,
      rotationIndex: rotation.rotationIndex,
      rotationVersion: rotation.rotationVersion,
      culturalSubject: entry.subject,
      subjectType: entry.subjectType,
      region: entry.region,
      culturalTopic: entry.shortSummary,
      knowledgeEntryId: entry.id,
      confidence: entry.confidence,
      reviewStatus: reviewFlags.length ? "Requires Review" : "ready",
      reviewFlags,
      selectedHashtags: post.hashtags,
      openingSentence: post.openingSentence,
      featuredFact: post.featuredFact,
      imageLens: image.imageLens,
      imageBehaviourSignal: image.imageBehaviourSignal,
      imageCompositionSignature: image.imageCompositionSignature,
      requiresManualImageReview: image.requiresManualImageReview,
      xText: post.xText,
      thursdayLingo: lingo.thursdayLingo,
    };

    const lingoBlock = formatLingoBlock(seriesMeta.thursdayLingo);
    const text = [post.familyText, "", lingoBlock].filter(Boolean).join("\n");

    return {
      ok: true,
      scheduledDate,
      rotation,
      entry,
      post,
      image,
      lingo,
      seriesMeta,
      text,
      topic: `Masters of Yesterday — ${entry.subject}`,
      imageBrief: image.imageBrief,
    };
  }

  /**
   * Idempotent: create or return existing Thursday MoY draft for scheduled date.
   */
  async generateAndStore(opts = {}) {
    const edition = await this.buildEdition(opts);
    if (!edition.ok) {
      // Still create a reviewable shell so Thursday is not empty
      const scheduledDate = edition.scheduledDate;
      const existing = await this._findForDate(scheduledDate);
      if (existing) return { item: existing, edition, action: "exists" };

      const { item } = await this.publishingService.createDraft({
        stream: "orok-morning",
        plannedDate: scheduledDate,
        status: "draft",
        category: "Masters of Yesterday",
        topic: "Masters of Yesterday — Requires Review",
        text: "Masters of Yesterday draft requires review: cultural catalogue unavailable for this week.",
        imageRequired: true,
        imageBrief: "Heritage Lens — manual review required.",
        seriesMeta: {
          category: "Masters of Yesterday",
          scheduledDate,
          reviewStatus: "Requires Review",
          countryStream: edition.rotation && edition.rotation.countryStream.id,
          rotationIndex: edition.rotation && edition.rotation.rotationIndex,
          rotationVersion: edition.rotation && edition.rotation.rotationVersion,
        },
        notes: "Auto-prepared MoY shell — Requires Review.",
      });
      return { item, edition, action: "created-review-shell" };
    }

    const existing = await this._findForDate(edition.scheduledDate);
    if (existing) {
      return { item: existing, edition, action: "exists" };
    }

    const status =
      edition.seriesMeta.reviewStatus === "Requires Review" ? "draft" : "draft";

    const { item } = await this.publishingService.createDraft({
      stream: "orok-morning",
      plannedDate: edition.scheduledDate,
      status,
      category: "Masters of Yesterday",
      topic: edition.topic,
      text: edition.text,
      imageRequired: true,
      imageBrief: edition.imageBrief,
      seriesMeta: edition.seriesMeta,
      similarityKeys: {
        opening: edition.post.openingSentence,
        centralLesson: edition.post.modernSignificance || edition.entry.modernSignificance,
        example: edition.post.featuredFact,
        imageConcept: edition.image.imageCompositionSignature,
      },
      notes: [
        `Masters of Yesterday · ${edition.rotation.countryStream.label}`,
        `rotation ${edition.rotation.rotationIndex} (${edition.rotation.rotationVersion})`,
        edition.seriesMeta.reviewStatus === "Requires Review"
          ? `Requires Review: ${(edition.seriesMeta.reviewFlags || []).join(", ")}`
          : "ready for review",
      ].join(". "),
    });

    return { item, edition, action: "created" };
  }

  async _moyHistory() {
    const items = await this.publishingService.listItems({
      category: "Masters of Yesterday",
    });
    // Also catch by topic prefix if category filter is adapter-limited
    const all = items.length
      ? items
      : (await this.publishingService.listItems({})).filter(
          (i) =>
            i.category === "Masters of Yesterday" ||
            (i.seriesMeta && i.seriesMeta.category === "Masters of Yesterday")
        );
    return all.filter(
      (i) => ["published", "approved", "draft", "review", "idea"].includes(i.status)
    );
  }

  async _findForDate(plannedDate) {
    const items = await this.publishingService.listItems({
      stream: "orok-morning",
      date: plannedDate,
    });
    return (
      items.find(
        (i) =>
          i.category === "Masters of Yesterday" &&
          ["idea", "draft", "review", "approved", "published"].includes(i.status)
      ) || null
    );
  }
}

function formatLingoBlock(lingo) {
  if (!lingo) {
    return "Thursday Lingo\nRequires Review — select a Learn Cook Islands Māori episode manually.";
  }
  const lines = ["Thursday Lingo", `Podcast: ${lingo.podcastName || "Learn Cook Islands Māori"}`];
  if (lingo.hosts) lines.push(`Hosts: ${lingo.hosts}`);
  if (lingo.status === "Requires Review") {
    lines.push("Status: Requires Review");
    if (lingo.note) lines.push(lingo.note);
    return lines.join("\n");
  }
  if (lingo.episodeTitle) lines.push(`Episode: ${lingo.episodeTitle}`);
  if (lingo.episodeNumber) lines.push(`Episode number: ${lingo.episodeNumber}`);
  if (lingo.applePodcastsUrl) {
    lines.push(`Listen: [${lingo.episodeTitle || "Apple Podcasts"}](${lingo.applePodcastsUrl})`);
  }
  return lines.join("\n");
}

module.exports = {
  MastersOfYesterdayEngine,
  getEntryById,
  formatLingoBlock,
};
