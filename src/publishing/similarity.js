"use strict";

/**
 * Deterministic, advisory duplicate detection for v0.1.
 *
 * We compare a candidate item against existing items across five dimensions:
 *   - topic
 *   - opening         (similarityKeys.opening, else derived from text)
 *   - centralLesson   (similarityKeys.centralLesson)
 *   - example         (similarityKeys.example)
 *   - imageConcept    (similarityKeys.imageConcept, else imageBrief)
 *
 * A draft is flagged as potentially repetitive when at least three dimensions
 * substantially match another single item. This is advisory ONLY: it never
 * rejects, deletes, or mutates anything.
 *
 * No embeddings, no external AI calls — pure string logic.
 */

const DIMENSIONS = ["topic", "opening", "centralLesson", "example", "imageConcept"];
const MATCH_THRESHOLD = 3;
const JACCARD_THRESHOLD = 0.6;

/** Normalize text: lowercase, strip punctuation, collapse whitespace. */
function normalize(value) {
  if (typeof value !== "string") return "";
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Token set from a normalized string, ignoring very short stop-like tokens. */
function tokens(value) {
  const norm = normalize(value);
  if (!norm) return new Set();
  return new Set(norm.split(" ").filter((t) => t.length > 2));
}

/** Jaccard similarity between two token sets. */
function jaccard(aSet, bSet) {
  if (aSet.size === 0 && bSet.size === 0) return 0;
  let intersection = 0;
  for (const t of aSet) {
    if (bSet.has(t)) intersection += 1;
  }
  const union = aSet.size + bSet.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Whether two dimension values "substantially match".
 * Empty values never match (so missing metadata cannot inflate the score).
 */
function dimensionMatches(a, b) {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  // containment: one clearly restates the other
  if (na.length >= 8 && nb.length >= 8 && (na.includes(nb) || nb.includes(na))) {
    return true;
  }
  return jaccard(tokens(a), tokens(b)) >= JACCARD_THRESHOLD;
}

/**
 * Derive the comparable dimension values for an item.
 * @param {any} item
 */
function dimensionValues(item) {
  const keys = item.similarityKeys || {};
  const opening =
    keys.opening || deriveOpening(item.text) || "";
  const imageConcept = keys.imageConcept || item.imageBrief || "";
  return {
    topic: item.topic || "",
    opening,
    centralLesson: keys.centralLesson || "",
    example: keys.example || "",
    imageConcept,
  };
}

/** Derive an "opening" (first sentence-ish) from post text. */
function deriveOpening(text) {
  if (typeof text !== "string" || !text.trim()) return "";
  const firstLine = text.trim().split(/\n/)[0];
  const sentence = firstLine.split(/(?<=[.!?])\s/)[0] || firstLine;
  return sentence.slice(0, 140);
}

/**
 * Compare a candidate against a list of existing items.
 * @param {any} candidate
 * @param {Array<any>} existing
 * @returns {{ flagged: boolean, matches: Array<{ id: string, topic: string, matchedDimensions: string[], score: number }> }}
 */
function checkDuplicates(candidate, existing) {
  const candValues = dimensionValues(candidate);
  const matches = [];

  for (const other of existing) {
    if (!other || other.id === candidate.id) continue;
    // A rejected item is still recorded and worth flagging against, so we
    // include all statuses here (advisory awareness).
    const otherValues = dimensionValues(other);
    const matchedDimensions = DIMENSIONS.filter((dim) =>
      dimensionMatches(candValues[dim], otherValues[dim])
    );
    if (matchedDimensions.length >= MATCH_THRESHOLD) {
      matches.push({
        id: other.id,
        topic: other.topic,
        status: other.status,
        seriesNumber: other.seriesNumber,
        matchedDimensions,
        score: matchedDimensions.length,
      });
    }
  }

  matches.sort((a, b) => b.score - a.score);
  return { flagged: matches.length > 0, matches };
}

module.exports = {
  DIMENSIONS,
  MATCH_THRESHOLD,
  JACCARD_THRESHOLD,
  normalize,
  jaccard,
  dimensionMatches,
  dimensionValues,
  deriveOpening,
  checkDuplicates,
};
