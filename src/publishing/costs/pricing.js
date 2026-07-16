"use strict";

/**
 * Canonical model pricing for Publishing API Cost Ledger estimates.
 *
 * IMPORTANT:
 * - These figures are **estimates** for internal reporting only.
 * - They are NOT live lookups and must be updated manually when the provider
 *   changes pricing.
 * - Unknown models must not break generation; they record token usage with
 *   `estimatedCostUsd: null`.
 * - Image-generation costs are intentionally excluded from this ledger.
 *
 * Rates are USD per 1,000,000 tokens.
 *
 * @typedef {{ inputUsdPerMillionTokens: number, outputUsdPerMillionTokens: number }} ModelPricing
 */

/** @type {Readonly<Record<string, ModelPricing>>} */
const MODEL_PRICING = Object.freeze({
  // OpenAI GPT-4.1 family (update when provider pricing changes)
  "gpt-4.1-mini": Object.freeze({
    inputUsdPerMillionTokens: 0.4,
    outputUsdPerMillionTokens: 1.6,
  }),
  "gpt-4.1": Object.freeze({
    inputUsdPerMillionTokens: 2.0,
    outputUsdPerMillionTokens: 8.0,
  }),
  "gpt-4.1-nano": Object.freeze({
    inputUsdPerMillionTokens: 0.1,
    outputUsdPerMillionTokens: 0.4,
  }),
  // Common aliases / older models that may appear in responses
  "gpt-4o-mini": Object.freeze({
    inputUsdPerMillionTokens: 0.15,
    outputUsdPerMillionTokens: 0.6,
  }),
  "gpt-4o": Object.freeze({
    inputUsdPerMillionTokens: 2.5,
    outputUsdPerMillionTokens: 10.0,
  }),
});

/**
 * Look up pricing for a model id. Returns null for unknown models.
 * @param {string} [model]
 * @returns {ModelPricing|null}
 */
function getModelPricing(model) {
  if (!model || typeof model !== "string") return null;
  const direct = MODEL_PRICING[model];
  if (direct) return direct;
  // Tolerate versioned suffixes like "gpt-4.1-mini-2025-04-14"
  const base = Object.keys(MODEL_PRICING).find(
    (key) => model === key || model.startsWith(key + "-")
  );
  return base ? MODEL_PRICING[base] : null;
}

/**
 * Estimate USD cost from token counts and model pricing.
 * Returns null when the model is unknown or token inputs are not usable numbers.
 *
 * estimatedCostUsd =
 *   (inputTokens / 1_000_000) * inputRate +
 *   (outputTokens / 1_000_000) * outputRate
 *
 * @param {{ model?: string, inputTokens?: number|null, outputTokens?: number|null }} usage
 * @returns {number|null}
 */
function estimateCostUsd(usage = {}) {
  const pricing = getModelPricing(usage.model);
  if (!pricing) return null;

  const inputTokens = toNonNegInt(usage.inputTokens);
  const outputTokens = toNonNegInt(usage.outputTokens);
  if (inputTokens === null && outputTokens === null) return null;

  const input = inputTokens || 0;
  const output = outputTokens || 0;
  const cost =
    (input / 1_000_000) * pricing.inputUsdPerMillionTokens +
    (output / 1_000_000) * pricing.outputUsdPerMillionTokens;

  // Round to 8 decimal places for stable storage/display of tiny costs.
  return Math.round(cost * 1e8) / 1e8;
}

function toNonNegInt(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return null;
  }
  return Math.floor(value);
}

module.exports = {
  MODEL_PRICING,
  getModelPricing,
  estimateCostUsd,
};
