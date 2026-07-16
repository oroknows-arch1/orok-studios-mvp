"use strict";

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");

const { PublishingRepository } = require("./repository-interface");

/**
 * In-memory adapter. Useful for isolated tests and as an explicit
 * development-only fallback. Data does NOT survive a process restart.
 */
class InMemoryPublishingRepository extends PublishingRepository {
  constructor(seed = []) {
    super();
    /** @type {Map<string, object>} */
    this._items = new Map();
    for (const item of seed) this._items.set(item.id, clone(item));
  }
  getStorageType() {
    return "memory";
  }
  async init() {}
  async list(filter) {
    const items = Array.from(this._items.values()).map(clone);
    return filter ? applyInMemoryFilter(items, filter) : items;
  }
  async get(id) {
    const found = this._items.get(id);
    return found ? clone(found) : null;
  }
  async create(item) {
    this._items.set(item.id, clone(item));
    return clone(item);
  }
  async save(item) {
    this._items.set(item.id, clone(item));
    return clone(item);
  }
  async delete(id) {
    return this._items.delete(id);
  }
  async atomicUpdate(id, mutator) {
    // Node is single-threaded; reading and writing without yielding between the
    // read and the mutator decision keeps this atomic for a single process.
    const current = this._items.get(id);
    if (!current) return null;
    const next = await mutator(clone(current));
    if (!next) return null;
    this._items.set(id, clone(next));
    return clone(next);
  }
}

/**
 * JSON file adapter. Writes atomically (temp file + rename). DEVELOPMENT-ONLY
 * persistence: on Render's default filesystem it is ephemeral and lost on
 * redeploy/restart. See docs/PUBLISHING.md and docs/DATABASE.md.
 */
class FilePublishingRepository extends PublishingRepository {
  /** @param {string} filePath */
  constructor(filePath) {
    super();
    this.filePath = filePath;
    /** @type {object[]|null} */
    this._cache = null;
    this._writeChain = Promise.resolve();
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
    await this._readAll();
  }

  async _readAll() {
    try {
      const raw = await fsp.readFile(this.filePath, "utf8");
      const parsed = raw.trim() ? JSON.parse(raw) : [];
      this._cache = Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      if (err.code === "ENOENT") {
        this._cache = [];
      } else {
        throw err;
      }
    }
    return this._cache;
  }

  async _writeAll(items) {
    this._cache = items;
    const tmp = `${this.filePath}.${process.pid}.tmp`;
    const payload = JSON.stringify(items, null, 2);
    this._writeChain = this._writeChain.then(async () => {
      await fsp.writeFile(tmp, payload, "utf8");
      await fsp.rename(tmp, this.filePath);
    });
    return this._writeChain;
  }

  async list(filter) {
    const items = (this._cache || (await this._readAll())).map(clone);
    return filter ? applyInMemoryFilter(items, filter) : items;
  }
  async get(id) {
    const items = this._cache || (await this._readAll());
    const found = items.find((i) => i.id === id);
    return found ? clone(found) : null;
  }
  async create(item) {
    const items = this._cache || (await this._readAll());
    items.push(clone(item));
    await this._writeAll(items);
    return clone(item);
  }
  async save(item) {
    const items = this._cache || (await this._readAll());
    const idx = items.findIndex((i) => i.id === item.id);
    if (idx === -1) items.push(clone(item));
    else items[idx] = clone(item);
    await this._writeAll(items);
    return clone(item);
  }
  async delete(id) {
    const items = this._cache || (await this._readAll());
    const idx = items.findIndex((i) => i.id === id);
    if (idx === -1) return false;
    items.splice(idx, 1);
    await this._writeAll(items);
    return true;
  }
  async atomicUpdate(id, mutator) {
    // Serialize atomic updates against each other for this single-process file
    // store so concurrent transitions cannot interleave.
    const run = this._mutex.then(async () => {
      const items = this._cache || (await this._readAll());
      const idx = items.findIndex((i) => i.id === id);
      if (idx === -1) return null;
      const next = await mutator(clone(items[idx]));
      if (!next) return null;
      items[idx] = clone(next);
      await this._writeAll(items);
      return clone(next);
    });
    // keep the chain alive regardless of individual failures
    this._mutex = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }
}

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/** Shared JS-side filter for the memory/file adapters. */
function applyInMemoryFilter(items, filter) {
  let out = items;
  if (filter.stream) out = out.filter((i) => i.stream === filter.stream);
  if (filter.status) out = out.filter((i) => i.status === filter.status);
  if (filter.date) {
    const d = String(filter.date).slice(0, 10);
    out = out.filter((i) => String(i.plannedDate).slice(0, 10) === d);
  }
  if (filter.topic && String(filter.topic).trim()) {
    const q = String(filter.topic).toLowerCase().trim();
    out = out.filter(
      (i) =>
        (i.topic || "").toLowerCase().includes(q) ||
        (i.text || "").toLowerCase().includes(q) ||
        (i.category || "").toLowerCase().includes(q)
    );
  }
  return out;
}

/**
 * Factory: choose a repository adapter from environment configuration.
 *
 *   PUBLISHING_STORAGE = "memory" | "file" | "postgres" (default: "file")
 *   PUBLISHING_DATA_FILE = path to JSON file (file mode)
 *   DATABASE_URL = postgres connection string (postgres mode, REQUIRED)
 *
 * Behaviour:
 *   - postgres requires DATABASE_URL; missing/invalid -> throws a clear error.
 *   - There is NO silent fallback from postgres to file/memory.
 *
 * @param {object} [opts]
 * @returns {PublishingRepository}
 */
function createRepositoryFromEnv(opts = {}) {
  const mode = (opts.mode || process.env.PUBLISHING_STORAGE || "file").toLowerCase();

  if (mode === "memory") {
    return new InMemoryPublishingRepository(opts.seed || []);
  }

  if (mode === "file") {
    const filePath =
      opts.filePath ||
      process.env.PUBLISHING_DATA_FILE ||
      path.join(process.cwd(), "data", "publishing.json");
    return new FilePublishingRepository(filePath);
  }

  if (mode === "postgres") {
    // Lazy-require so the pg dependency is only loaded when actually selected.
    const { createPool } = require("./db/pool");
    const { PostgresPublishingRepository } = require("./db/postgres-repository");
    const url = opts.databaseUrl || process.env.DATABASE_URL;
    // createPool calls assertDatabaseUrl and throws a clear, credential-free
    // error when DATABASE_URL is missing or malformed — no silent fallback.
    const pool = opts.pool || createPool(url);
    return new PostgresPublishingRepository(pool);
  }

  throw new Error(
    `Unknown PUBLISHING_STORAGE value: "${mode}". Use "memory", "file", or "postgres".`
  );
}

module.exports = {
  PublishingRepository,
  InMemoryPublishingRepository,
  FilePublishingRepository,
  createRepositoryFromEnv,
};
