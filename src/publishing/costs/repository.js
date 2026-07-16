"use strict";

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");

const { CostLedgerRepository } = require("./repository-interface");
const { filterByDateRange, buildSummary } = require("./aggregates");
const { GENERATION_COST_STATUSES } = require("./usage");

/**
 * In-memory cost ledger. Ephemeral — for tests and local memory mode.
 */
class InMemoryCostLedgerRepository extends CostLedgerRepository {
  constructor(seed = []) {
    super();
    /** @type {Map<string, object>} keyed by generationId */
    this._byGeneration = new Map();
    for (const r of seed) this._byGeneration.set(r.generationId, clone(r));
  }

  getStorageType() {
    return "memory";
  }

  async create(record) {
    const row = clone(record);
    this._byGeneration.set(row.generationId, row);
    return clone(row);
  }

  async getByGenerationId(generationId) {
    const found = this._byGeneration.get(generationId);
    return found ? clone(found) : null;
  }

  async attachPublishingItem(generationId, publishingItemId) {
    return this._update(generationId, (row) => {
      row.publishingItemId = publishingItemId;
    });
  }

  async markAccepted(generationId) {
    return this._setStatus(generationId, "accepted");
  }

  async markDiscarded(generationId) {
    return this._setStatus(generationId, "discarded");
  }

  async markFailed(generationId) {
    return this._setStatus(generationId, "failed");
  }

  async listRecent(opts = {}) {
    const limit = Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : 25;
    return Array.from(this._byGeneration.values())
      .map(clone)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, limit);
  }

  async aggregateSummary(range = {}) {
    const all = Array.from(this._byGeneration.values());
    return buildSummary(filterByDateRange(all, range));
  }

  async _setStatus(generationId, status) {
    if (!GENERATION_COST_STATUSES.includes(status)) {
      throw new Error(`invalid cost status: ${status}`);
    }
    return this._update(generationId, (row) => {
      row.status = status;
    });
  }

  async _update(generationId, mutator) {
    const current = this._byGeneration.get(generationId);
    if (!current) return null;
    const next = clone(current);
    mutator(next);
    next.updatedAt = new Date().toISOString();
    this._byGeneration.set(generationId, next);
    return clone(next);
  }
}

/**
 * JSON-file cost ledger for local development (ephemeral on Render).
 */
class FileCostLedgerRepository extends CostLedgerRepository {
  constructor(filePath) {
    super();
    this.filePath = filePath;
    this._cache = null;
    this._mutex = Promise.resolve();
  }

  getStorageType() {
    return "file";
  }

  async init() {
    const dir = path.dirname(this.filePath);
    await fsp.mkdir(dir, { recursive: true });
    if (!fs.existsSync(this.filePath)) {
      await this._writeAll([]);
    }
  }

  async create(record) {
    return this._withLock(async () => {
      const all = await this._readAll();
      const idx = all.findIndex((r) => r.generationId === record.generationId);
      const row = clone(record);
      if (idx >= 0) all[idx] = row;
      else all.push(row);
      await this._writeAll(all);
      return clone(row);
    });
  }

  async getByGenerationId(generationId) {
    const all = await this._readAll();
    const found = all.find((r) => r.generationId === generationId);
    return found ? clone(found) : null;
  }

  async attachPublishingItem(generationId, publishingItemId) {
    return this._update(generationId, (row) => {
      row.publishingItemId = publishingItemId;
    });
  }

  async markAccepted(generationId) {
    return this._update(generationId, (row) => {
      row.status = "accepted";
    });
  }

  async markDiscarded(generationId) {
    return this._update(generationId, (row) => {
      row.status = "discarded";
    });
  }

  async markFailed(generationId) {
    return this._update(generationId, (row) => {
      row.status = "failed";
    });
  }

  async listRecent(opts = {}) {
    const limit = Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : 25;
    const all = await this._readAll();
    return all
      .map(clone)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, limit);
  }

  async aggregateSummary(range = {}) {
    const all = await this._readAll();
    return buildSummary(filterByDateRange(all, range));
  }

  async _update(generationId, mutator) {
    return this._withLock(async () => {
      const all = await this._readAll();
      const idx = all.findIndex((r) => r.generationId === generationId);
      if (idx < 0) return null;
      const next = clone(all[idx]);
      mutator(next);
      next.updatedAt = new Date().toISOString();
      all[idx] = next;
      await this._writeAll(all);
      return clone(next);
    });
  }

  async _withLock(fn) {
    const prev = this._mutex;
    let release;
    this._mutex = new Promise((r) => {
      release = r;
    });
    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  }

  async _readAll() {
    if (this._cache) return this._cache.map(clone);
    const raw = await fsp.readFile(this.filePath, "utf8");
    const parsed = JSON.parse(raw || "[]");
    this._cache = Array.isArray(parsed) ? parsed : [];
    return this._cache.map(clone);
  }

  async _writeAll(rows) {
    const dir = path.dirname(this.filePath);
    await fsp.mkdir(dir, { recursive: true });
    const tmp = this.filePath + ".tmp";
    await fsp.writeFile(tmp, JSON.stringify(rows, null, 2), "utf8");
    await fsp.rename(tmp, this.filePath);
    this._cache = rows.map(clone);
  }
}

/**
 * Factory matching PUBLISHING_STORAGE mode.
 * @param {object} [opts]
 * @returns {CostLedgerRepository}
 */
function createCostRepositoryFromEnv(opts = {}) {
  const mode = (opts.mode || process.env.PUBLISHING_STORAGE || "file").toLowerCase();

  if (mode === "memory") {
    return new InMemoryCostLedgerRepository(opts.seed || []);
  }

  if (mode === "file") {
    const filePath =
      opts.filePath ||
      process.env.PUBLISHING_COST_DATA_FILE ||
      path.join(process.cwd(), "data", "publishing-costs.json");
    return new FileCostLedgerRepository(filePath);
  }

  if (mode === "postgres") {
    const { createPool } = require("../db/pool");
    const { PostgresCostLedgerRepository } = require("../db/postgres-cost-repository");
    const url = opts.databaseUrl || process.env.DATABASE_URL;
    const pool = opts.pool || createPool(url);
    return new PostgresCostLedgerRepository(pool);
  }

  throw new Error(
    `Unknown PUBLISHING_STORAGE value for cost ledger: "${mode}". Use "memory", "file", or "postgres".`
  );
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

module.exports = {
  CostLedgerRepository,
  InMemoryCostLedgerRepository,
  FileCostLedgerRepository,
  createCostRepositoryFromEnv,
};
