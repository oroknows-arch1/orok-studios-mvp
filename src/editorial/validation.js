"use strict";

const { GENERIC_SELF_HELP_PHRASES } = require("./voice");
const {
  FAMILY_GREETING,
  FAMILY_SIGNOFF,
  getSurfaceRules,
} = require("./formatting");
const { EditorialValidationError } = require("./types");
const { flattenGroundingDetails } = require("./grounding");

/**
 * Profile-aware output validation.
 */

/**
 * @param {string[]} candidates
 * @param {import("./types").ResolvedEditorialContext} context
 * @returns {{ ok: true, candidates: string[] } | never}
 */
function validateCandidates(candidates, context) {
  const errors = [];
  const profile = context.profile;
  const surface = context.surface;
  const surfaceRules = getSurfaceRules(surface);

  if (!profile) {
    throw new EditorialValidationError("Missing editorial profile", [
      "cannot validate without a resolved OROK profile",
    ]);
  }

  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw new EditorialValidationError("No candidates to validate", [
      "generation produced an empty body",
    ]);
  }

  const normalised = candidates.map((c) => String(c || "").trim()).filter(Boolean);
  if (!normalised.length) {
    throw new EditorialValidationError("No candidates to validate", [
      "generation produced an empty body",
    ]);
  }

  for (let i = 0; i < normalised.length; i++) {
    const text = normalised[i];
    const label = `candidate ${i + 1}`;

    if (!text) errors.push(`${label}: empty body`);

    // Profile / prompt leakage
    if (/Observation Signal|Pattern Signal|Coffee Break Signal/i.test(text)) {
      errors.push(`${label}: internal reasoning labels leaked into output`);
    }
    if (/EDITORIAL PROFILE|OUTPUT SURFACE|FACTUAL GROUNDING/i.test(text)) {
      errors.push(`${label}: prompt instructions leaked into output`);
    }

    // Generic placeholder / self-help
    const lower = text.toLowerCase();
    for (const phrase of GENERIC_SELF_HELP_PHRASES) {
      if (lower.includes(phrase)) {
        errors.push(`${label}: generic/prohibited phrase "${phrase}"`);
      }
    }

    if (surface === "family-message") {
      if (!text.startsWith(FAMILY_GREETING)) {
        errors.push(`${label}: must begin with exact family greeting`);
      }
      if (!text.trimEnd().endsWith(FAMILY_SIGNOFF)) {
        errors.push(`${label}: must end with exact family closing`);
      }
      if (/#\w+/.test(text) && !surfaceRules.allowHashtags) {
        errors.push(`${label}: hashtags not allowed on family-message surface`);
      }
    }

    if (surface === "x-post") {
      if (text.startsWith(FAMILY_GREETING) || /Enjoy the day love you all/i.test(text)) {
        errors.push(`${label}: X post must not include family greeting/closing`);
      }
      if (text.length > surfaceRules.maxChars) {
        errors.push(
          `${label}: exceeds X maximum of ${surfaceRules.maxChars} characters (${text.length})`
        );
      }
      const tags = text.match(/#[\w]+/g) || [];
      if (tags.length !== surfaceRules.exactHashtagCount) {
        errors.push(
          `${label}: X post requires exactly ${surfaceRules.exactHashtagCount} hashtags (found ${tags.length})`
        );
      }
    }

    // Profile-specific checks
    if (profile.id === "motivation") {
      if (/\bbelieve in yourself\b|\bnever give up\b/i.test(text)) {
        errors.push(`${label}: Motivation rejects generic self-help commands`);
      }
    }

    if (profile.id === "long-game") {
      if (/\bmortgage\b|\bmortgages\b/i.test(text)) {
        errors.push(`${label}: Long Game must avoid mortgage assumptions`);
      }
    }

    if (profile.id === "coffee-break-build") {
      if (/\blaunching soon\b|\bgame.?changer\b|\brevolutioni[sz]e\b/i.test(text)) {
        errors.push(`${label}: Coffee Break Build must avoid launch-style hype`);
      }
    }

    if (profile.id === "cultural-series") {
      if (/live[sd]? in harmony with nature/i.test(text)) {
        errors.push(
          `${label}: Cultural Series forbids unsupported 'harmony with nature' phrasing`
        );
      }
      const details = flattenGroundingDetails(context.grounding);
      const hitCount = details.filter((d) =>
        text.toLowerCase().includes(String(d).toLowerCase())
      ).length;
      // Also count partial word hits from multi-word practices
      const practiceHits = details.filter((d) => {
        const words = String(d).toLowerCase().split(/\s+/).filter((w) => w.length > 3);
        return words.some((w) => text.toLowerCase().includes(w));
      }).length;
      if (Math.max(hitCount, practiceHits) < 3) {
        errors.push(
          `${label}: Cultural Series must include at least three supplied factual details`
        );
      }
      const continuity =
        context.grounding &&
        (context.grounding.continuity || context.grounding.presentDay);
      if (continuity && !/\btoday\b|\bcontinue|continuing|living\b|\bstill\b/i.test(text)) {
        errors.push(
          `${label}: Cultural Series should refer to continuing/living culture in the present`
        );
      }
    }

    if (
      (profile.id === "masters-of-today" ||
        profile.id === "masters-of-yesterday" ||
        profile.id === "cultural-series") &&
      context.grounding
    ) {
      const details = flattenGroundingDetails(context.grounding);
      if (details.length >= 3) {
        const hits = details.filter((d) => {
          const chunk = String(d).toLowerCase();
          if (text.toLowerCase().includes(chunk)) return true;
          const words = chunk.split(/\s+/).filter((w) => w.length > 4);
          return words.some((w) => text.toLowerCase().includes(w));
        }).length;
        if (hits < 2) {
          errors.push(
            `${label}: factual profile must use concrete grounded detail`
          );
        }
      }
    }
  }

  // Distinctness — candidates must not be near-duplicates
  if (normalised.length >= 2) {
    for (let i = 0; i < normalised.length; i++) {
      for (let j = i + 1; j < normalised.length; j++) {
        const sim = jaccardSimilarity(
          normalizeForCompare(normalised[i]),
          normalizeForCompare(normalised[j])
        );
        if (sim >= 0.72) {
          errors.push(
            `candidates ${i + 1} and ${j + 1} are near-duplicates (similarity ${sim.toFixed(2)})`
          );
        }
      }
    }
  }

  if (errors.length) {
    throw new EditorialValidationError("Editorial validation failed", errors);
  }

  return { ok: true, candidates: normalised, editorialProfile: profile.id, surface };
}

function normalizeForCompare(text) {
  return String(text)
    .toLowerCase()
    .replace(FAMILY_GREETING.toLowerCase(), " ")
    .replace(FAMILY_SIGNOFF.toLowerCase(), " ")
    .replace(/#[\w]+/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);
}

function jaccardSimilarity(aWords, bWords) {
  const a = new Set(aWords);
  const b = new Set(bWords);
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter += 1;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

module.exports = {
  validateCandidates,
  normalizeForCompare,
  jaccardSimilarity,
};
