"use strict";

const crypto = require("crypto");
const { estimateCostUsd } = require("./pricing");

/**
 * @typedef {"generated"|"accepted"|"discarded"|"failed"} GenerationCostStatus
 */

/** @type {readonly GenerationCostStatus[]} */
const GENERATION_COST_STATUSES = Object.freeze([
  "generated",
  "accepted",
  "discarded",
  "failed",
]);

const DEFAULT_PROVIDER = "openai";

/**
 * @typedef {Object} GenerationUsageRecord
 * @property {string} id
 * @property {string} generationId
 * @property {string|null} [publishingItemId]
 * @property {string|null} [stream]
 * @property {string|null} [category]
 * @property {string} provider
 * @property {string|null} [model]
 * @property {number|null} [inputTokens]
 * @property {number|null} [outputTokens]
 * @property {number|null} [totalTokens]
 * @property {number|null} [estimatedCostUsd]
 * @property {GenerationCostStatus} status
 * @property {string} createdAt
 * @property {string} updatedAt
 */

/**
 * Build a GenerationUsageRecord from partial input + optional provider usage.
 * Does not persist — callers validate/store via the cost repository.
 *
 * @param {Partial<GenerationUsageRecord> & {
 *   usage?: {
 *     model?: string|null,
 *     inputTokens?: number|null,
 *     outputTokens?: number|null,
 *     totalTokens?: number|null,
 *   }
 * }} input
 * @returns {GenerationUsageRecord}
 */
function createUsageRecord(input = {}) {
  const now = new Date().toISOString();
  const usage = input.usage || {};
  const model =
    pickString(input.model) || pickString(usage.model) || null;
  const inputTokens = pickToken(input.inputTokens, usage.inputTokens);
  const outputTokens = pickToken(input.outputTokens, usage.outputTokens);
  let totalTokens = pickToken(input.totalTokens, usage.totalTokens);
  if (
    totalTokens === null &&
    inputTokens !== null &&
    outputTokens !== null
  ) {
    totalTokens = inputTokens + outputTokens;
  }

  const estimated =
    input.estimatedCostUsd !== undefined
      ? input.estimatedCostUsd
      : estimateCostUsd({ model, inputTokens, outputTokens });

  const status = GENERATION_COST_STATUSES.includes(input.status)
    ? input.status
    : "generated";

  return {
    id: pickString(input.id) || crypto.randomUUID(),
    generationId: pickString(input.generationId) || crypto.randomUUID(),
    publishingItemId: pickString(input.publishingItemId) || null,
    stream: pickString(input.stream) || null,
    category: pickString(input.category) || null,
    provider: pickString(input.provider) || DEFAULT_PROVIDER,
    model,
    inputTokens,
    outputTokens,
    totalTokens,
    estimatedCostUsd:
      estimated === undefined || estimated === null
        ? null
        : Number(estimated),
    status,
    createdAt: pickString(input.createdAt) || now,
    updatedAt: pickString(input.updatedAt) || now,
  };
}

/**
 * Map an OpenAI chat.completions response into usage metadata.
 * Prefer provider-reported usage; never invent token counts.
 * Delegates to the shared generator mapper so OpenAI field names stay in one place.
 *
 * @param {object} response
 * @param {{ fallbackModel?: string }} [opts]
 */
function mapOpenAIUsage(response, opts = {}) {
  const { mapProviderChatUsage } = require("../../generator/usage-map");
  return mapProviderChatUsage(response, {
    fallbackModel: opts.fallbackModel,
    provider: DEFAULT_PROVIDER,
  });
}

/**
 * Public usage payload safe for API responses (no secrets / raw provider bodies).
 * @param {GenerationUsageRecord|object} record
 */
function toPublicUsage(record) {
  if (!record) return null;
  return {
    model: record.model || null,
    inputTokens: record.inputTokens ?? null,
    outputTokens: record.outputTokens ?? null,
    totalTokens: record.totalTokens ?? null,
    estimatedCostUsd: record.estimatedCostUsd ?? null,
  };
}

function pickString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function pickToken(primary, fallback) {
  const a = toToken(primary);
  if (a !== null) return a;
  return toToken(fallback);
}

function toToken(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return null;
  }
  return Math.floor(value);
}

module.exports = {
  GENERATION_COST_STATUSES,
  DEFAULT_PROVIDER,
  createUsageRecord,
  mapOpenAIUsage,
  toPublicUsage,
};
