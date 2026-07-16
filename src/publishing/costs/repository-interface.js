"use strict";

/**
 * Cost ledger repository contract.
 * Observational only — never gates generation, approval, or publishing.
 */
class CostLedgerRepository {
  getStorageType() {
    throw new Error("not implemented");
  }
  async init() {}
  async close() {}

  /** @param {import("./usage").GenerationUsageRecord} record */
  async create(record) {
    throw new Error("not implemented");
  }

  /** @param {string} generationId */
  async getByGenerationId(generationId) {
    throw new Error("not implemented");
  }

  /**
   * @param {string} generationId
   * @param {string} publishingItemId
   */
  async attachPublishingItem(generationId, publishingItemId) {
    throw new Error("not implemented");
  }

  /** @param {string} generationId */
  async markAccepted(generationId) {
    throw new Error("not implemented");
  }

  /** @param {string} generationId */
  async markDiscarded(generationId) {
    throw new Error("not implemented");
  }

  /** @param {string} generationId */
  async markFailed(generationId) {
    throw new Error("not implemented");
  }

  /**
   * @param {{ limit?: number }} [opts]
   * @returns {Promise<import("./usage").GenerationUsageRecord[]>}
   */
  async listRecent(opts) {
    throw new Error("not implemented");
  }

  /**
   * Aggregate totals for an optional date range (inclusive ISO date/datetime).
   * @param {{ from?: string, to?: string }} [range]
   */
  async aggregateSummary(range) {
    throw new Error("not implemented");
  }
}

module.exports = { CostLedgerRepository };
