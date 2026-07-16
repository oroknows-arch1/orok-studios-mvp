"use strict";

const { NeedsGroundingError } = require("./types");

/**
 * Collect factual grounding strings from a structured grounding object.
 * @param {object|null|undefined} grounding
 * @returns {string[]}
 */
function flattenGroundingDetails(grounding) {
  if (!grounding || typeof grounding !== "object") return [];
  const details = [];

  const push = (value) => {
    if (typeof value === "string" && value.trim()) details.push(value.trim());
    else if (Array.isArray(value)) {
      for (const v of value) {
        if (typeof v === "string" && v.trim()) details.push(v.trim());
      }
    }
  };

  for (const [key, value] of Object.entries(grounding)) {
    if (key === "sources" || key === "citations") continue;
    if (typeof value === "string") push(value);
    else if (Array.isArray(value)) push(value);
    else if (value && typeof value === "object") {
      for (const v of Object.values(value)) push(v);
    }
  }

  return details;
}

/**
 * Assert required grounding for factual profiles.
 * @param {import("./types").EditorialProfile} profile
 * @param {object|null|undefined} grounding
 */
function assertGrounding(profile, grounding) {
  if (!profile.requiresGrounding) return;

  const details = flattenGroundingDetails(grounding);
  const missing = [];

  if (!grounding || typeof grounding !== "object") {
    throw new NeedsGroundingError(
      `Profile "${profile.label}" requires factual grounding`,
      profile.groundingKeys || ["grounding"]
    );
  }

  for (const key of profile.groundingKeys || []) {
    const value = grounding[key];
    const ok =
      (typeof value === "string" && value.trim()) ||
      (Array.isArray(value) && value.some((v) => String(v).trim())) ||
      (value && typeof value === "object" && Object.keys(value).length > 0);
    if (!ok && key !== "facts") missing.push(key);
  }

  // Accept a generic `facts` array with ≥3 items as sufficient for masters profiles
  const facts = grounding.facts;
  const factCount = Array.isArray(facts)
    ? facts.filter((f) => String(f).trim()).length
    : 0;

  if (details.length < 3 && factCount < 3) {
    missing.push("at least 3 concrete factual details");
  }

  if (missing.length) {
    throw new NeedsGroundingError(
      `Profile "${profile.label}" is missing required factual grounding`,
      missing
    );
  }
}

/**
 * @param {object|null|undefined} grounding
 * @returns {string}
 */
function renderGroundingBlock(grounding) {
  if (!grounding || typeof grounding !== "object") {
    return "FACTUAL GROUNDING: none supplied.";
  }
  const lines = ["FACTUAL GROUNDING (use only these facts — do not invent more):"];
  for (const [key, value] of Object.entries(grounding)) {
    if (key === "sources" || key === "citations") {
      lines.push(`- ${key}: (retained internally; do not invent citations)`);
      continue;
    }
    if (Array.isArray(value)) {
      lines.push(`- ${key}:`);
      for (const v of value) lines.push(`  - ${v}`);
    } else if (value && typeof value === "object") {
      lines.push(`- ${key}: ${JSON.stringify(value)}`);
    } else {
      lines.push(`- ${key}: ${value}`);
    }
  }
  lines.push(
    "If a detail is not in this grounding, omit it. Never invent cultural, historical, or biographical facts."
  );
  return lines.join("\n");
}

module.exports = {
  flattenGroundingDetails,
  assertGrounding,
  renderGroundingBlock,
};
