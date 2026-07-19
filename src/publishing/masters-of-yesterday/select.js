"use strict";

const { listApprovedByCountry } = require("./catalogue");

/**
 * Select cultural entry with anti-repetition within a country stream.
 * Avoids premature subject/topic/opening/fact/hashtag/image repeats.
 * After catalogue exhaustion, picks least-recently-used eligible subject.
 *
 * @param {string} countryStreamId
 * @param {Array<object>} historyItems prior MoY items (seriesMeta or fields)
 * @returns {object|null}
 */
function selectCulturalEntry(countryStreamId, historyItems = []) {
  const approved = listApprovedByCountry(countryStreamId);
  if (!approved.length) return null;

  const history = historyItems
    .map((i) => normalizeHistory(i))
    .filter((h) => h.countryStream === countryStreamId);

  const usedSubjects = new Set(history.map((h) => h.culturalSubject).filter(Boolean));
  const unused = approved.filter((e) => !usedSubjects.has(e.subject));

  if (unused.length) {
    // Deterministic: stable sort by id, pick first unused
    unused.sort((a, b) => a.id.localeCompare(b.id));
    // Also avoid opening/hashtag collisions when possible
    const filtered = unused.filter((e) => {
      const tags = (e.suggestedHashtags || []).join(" ");
      return !history.some(
        (h) =>
          h.hashtagCombination === tags ||
          h.imageCompositionSignature ===
            `${countryStreamId}::${e.id}::${e.imageBehaviourSignal}::${e.imageEnvironment}`
      );
    });
    const pool = filtered.length ? filtered : unused;
    return pool[0];
  }

  // Exhaustion — least recently used by lastScheduledDate
  const lastUsed = new Map();
  for (const h of history) {
    if (!h.culturalSubject) continue;
    const prev = lastUsed.get(h.culturalSubject);
    if (!prev || String(h.scheduledDate) > String(prev)) {
      lastUsed.set(h.culturalSubject, h.scheduledDate || "");
    }
  }
  const ranked = [...approved].sort((a, b) => {
    const da = lastUsed.get(a.subject) || "";
    const db = lastUsed.get(b.subject) || "";
    if (da !== db) return String(da).localeCompare(String(db));
    return a.id.localeCompare(b.id);
  });
  return ranked[0] || null;
}

function normalizeHistory(item) {
  const meta = item.seriesMeta || item.mastersOfYesterday || {};
  return {
    countryStream: meta.countryStream || meta.countryStreamId,
    culturalSubject: meta.culturalSubject || item.topic,
    scheduledDate: meta.scheduledDate || item.plannedDate,
    hashtagCombination: Array.isArray(meta.selectedHashtags)
      ? meta.selectedHashtags.join(" ")
      : meta.hashtagCombination,
    imageCompositionSignature: meta.imageCompositionSignature,
    openingSentence: meta.openingSentence,
    featuredFact: meta.featuredFact,
    episodeId: meta.thursdayLingo && meta.thursdayLingo.episodeId,
  };
}

/**
 * Collect used episode ids from MoY history across all countries.
 */
function collectUsedEpisodeIds(historyItems = []) {
  const ids = [];
  for (const item of historyItems) {
    const meta = item.seriesMeta || item.mastersOfYesterday || {};
    const id = meta.thursdayLingo && meta.thursdayLingo.episodeId;
    if (id) ids.push(String(id));
  }
  return ids;
}

module.exports = {
  selectCulturalEntry,
  collectUsedEpisodeIds,
  normalizeHistory,
};
