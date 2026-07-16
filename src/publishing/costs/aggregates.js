"use strict";

/**
 * Pure aggregation helpers shared by memory/file/postgres adapters so summary
 * shape stays consistent across storage modes.
 */

/**
 * @param {import("./usage").GenerationUsageRecord[]} records
 * @param {{ from?: string, to?: string }} [range]
 */
function filterByDateRange(records, range = {}) {
  const fromMs = parseBound(range.from, false);
  const toMs = parseBound(range.to, true);
  return records.filter((r) => {
    const t = Date.parse(r.createdAt);
    if (Number.isNaN(t)) return false;
    if (fromMs !== null && t < fromMs) return false;
    if (toMs !== null && t > toMs) return false;
    return true;
  });
}

/**
 * @param {import("./usage").GenerationUsageRecord[]} records
 */
function buildSummary(records) {
  let totalEstimatedCost = 0;
  let costSamples = 0;
  let acceptedCost = 0;
  let acceptedWithCost = 0;
  const byStream = {};
  const byModel = {};
  let totalGenerations = 0;
  let totalAccepted = 0;
  let totalDiscarded = 0;
  let totalFailed = 0;

  for (const r of records) {
    totalGenerations += 1;
    if (r.status === "accepted") totalAccepted += 1;
    else if (r.status === "discarded") totalDiscarded += 1;
    else if (r.status === "failed") totalFailed += 1;

    if (typeof r.estimatedCostUsd === "number" && Number.isFinite(r.estimatedCostUsd)) {
      totalEstimatedCost += r.estimatedCostUsd;
      costSamples += 1;
      if (r.status === "accepted") {
        acceptedCost += r.estimatedCostUsd;
        acceptedWithCost += 1;
      }
    }

    const streamKey = r.stream || "unknown";
    if (!byStream[streamKey]) {
      byStream[streamKey] = { generations: 0, accepted: 0, estimatedCostUsd: 0 };
    }
    byStream[streamKey].generations += 1;
    if (r.status === "accepted") byStream[streamKey].accepted += 1;
    if (typeof r.estimatedCostUsd === "number" && Number.isFinite(r.estimatedCostUsd)) {
      byStream[streamKey].estimatedCostUsd += r.estimatedCostUsd;
    }

    const modelKey = r.model || "unknown";
    if (!byModel[modelKey]) {
      byModel[modelKey] = { generations: 0, accepted: 0, estimatedCostUsd: 0 };
    }
    byModel[modelKey].generations += 1;
    if (r.status === "accepted") byModel[modelKey].accepted += 1;
    if (typeof r.estimatedCostUsd === "number" && Number.isFinite(r.estimatedCostUsd)) {
      byModel[modelKey].estimatedCostUsd += r.estimatedCostUsd;
    }
  }

  const round = (n) => Math.round(n * 1e8) / 1e8;

  return {
    totalGenerations,
    totalAccepted,
    totalDiscarded,
    totalFailed,
    totalEstimatedCostUsd: round(totalEstimatedCost),
    averageCostPerGenerationUsd:
      costSamples > 0 ? round(totalEstimatedCost / costSamples) : null,
    averageCostPerAcceptedPostUsd:
      acceptedWithCost > 0 ? round(acceptedCost / acceptedWithCost) : null,
    byStream: roundGroup(byStream, round),
    byModel: roundGroup(byModel, round),
  };
}

function roundGroup(group, round) {
  const out = {};
  for (const [k, v] of Object.entries(group)) {
    out[k] = {
      generations: v.generations,
      accepted: v.accepted,
      estimatedCostUsd: round(v.estimatedCostUsd),
    };
  }
  return out;
}

function parseBound(value, endOfDay) {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  // Date-only → expand to start/end of UTC day
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const ms = Date.parse(
      endOfDay ? `${trimmed}T23:59:59.999Z` : `${trimmed}T00:00:00.000Z`
    );
    return Number.isNaN(ms) ? null : ms;
  }
  const ms = Date.parse(trimmed);
  return Number.isNaN(ms) ? null : ms;
}

module.exports = { filterByDateRange, buildSummary };
