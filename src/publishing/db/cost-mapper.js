"use strict";

/**
 * Map between GenerationUsageRecord (camelCase) and publishing_generation_costs rows.
 */

const COST_COLUMNS = Object.freeze([
  "id",
  "generation_id",
  "publishing_item_id",
  "stream",
  "category",
  "provider",
  "model",
  "input_tokens",
  "output_tokens",
  "total_tokens",
  "estimated_cost_usd",
  "status",
  "created_at",
  "updated_at",
]);

function toIso(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function toIntOrNull(value) {
  const n = toNumberOrNull(value);
  return n === null ? null : Math.floor(n);
}

/** @param {any} row */
function rowToCostRecord(row) {
  if (!row) return null;
  return {
    id: row.id,
    generationId: row.generation_id,
    publishingItemId: row.publishing_item_id || null,
    stream: row.stream || null,
    category: row.category || null,
    provider: row.provider || "openai",
    model: row.model || null,
    inputTokens: toIntOrNull(row.input_tokens),
    outputTokens: toIntOrNull(row.output_tokens),
    totalTokens: toIntOrNull(row.total_tokens),
    estimatedCostUsd: toNumberOrNull(row.estimated_cost_usd),
    status: row.status,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

/** @param {import("../costs/usage").GenerationUsageRecord} record */
function costRecordToValues(record) {
  return [
    record.id,
    record.generationId,
    record.publishingItemId || null,
    record.stream || null,
    record.category || null,
    record.provider || "openai",
    record.model || null,
    record.inputTokens ?? null,
    record.outputTokens ?? null,
    record.totalTokens ?? null,
    record.estimatedCostUsd ?? null,
    record.status,
    record.createdAt,
    record.updatedAt,
  ];
}

module.exports = {
  COST_COLUMNS,
  rowToCostRecord,
  costRecordToValues,
};
