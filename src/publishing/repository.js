"use strict";

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");

/**
 * Repository interface for publishing items. All storage access in the
 * publishing system goes through this interface so the backing store can be
 * swapped (in-memory, JSON file, or a real database) without touching the
 * service or route layers.
 *
 * @interface
 */
class PublishingRepository {
  /** Perform any async setup (create files/tables, etc). */
  async init() {}
  /** @returns {Promise<Array<object>>} all items */
  async list() {
    throw new Error("not implemented");
  }
  /** @param {string} id @returns {Promise<object|null>} */
  async get(_id) {
    throw new Error("not implemented");
  }
  /** @param {object} item @returns {Promise<object>} */
  async create(_item) {
    throw new Error("not implemented");
  }
  /** Persist a full item (upsert by id). @param {object} item */
  async save(_item) {
    throw new Error("not implemented");
  }
  /** @param {string} id @returns {Promise<boolean>} */
  async delete(_id) {
    throw new Error("not implemented");
  }
}

/**
 * In-memory adapter. Useful for tests and as an explicit development-only
 * fallback. Data does NOT survive a process restart.
 */
class InMemoryPublishingRepository extends PublishingRepository {
  constructor(seed = []) {
    super();
    /** @type {Map<string, object>} */
    this._items = new Map();
    for (const item of seed) this._items.set(item.id, clone(item));
  }
  async init() {}
  async list() {
    return Array.from(this._items.values()).map(clone);
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
}

/**
 * JSON file adapter. Writes atomically (temp file + rename) to avoid partial
 * writes. This is DEVELOPMENT-ONLY persistence: on Render's default filesystem
 * it is ephemeral and will be lost on redeploy/restart. See docs/PUBLISHING.md.
 */
class FilePublishingRepository extends PublishingRepository {
  /** @param {string} filePath */
  constructor(filePath) {
    super();
    this.filePath = filePath;
    /** @type {object[]|null} */
    this._cache = null;
    /** serialize writes */
    this._writeChain = Promise.resolve();
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
    // chain writes so concurrent saves don't interleave
    this._writeChain = this._writeChain.then(async () => {
      await fsp.writeFile(tmp, payload, "utf8");
      await fsp.rename(tmp, this.filePath);
    });
    return this._writeChain;
  }

  async list() {
    const items = this._cache || (await this._readAll());
    return items.map(clone);
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
}

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Factory: choose a repository adapter from environment configuration.
 *
 *   PUBLISHING_STORAGE = "memory" | "file" (default: "file")
 *   PUBLISHING_DATA_FILE = path to JSON file (default: <root>/data/publishing.json)
 *
 * @param {object} [opts]
 * @returns {PublishingRepository}
 */
function createRepositoryFromEnv(opts = {}) {
  const mode = (opts.mode || process.env.PUBLISHING_STORAGE || "file").toLowerCase();
  if (mode === "memory") {
    return new InMemoryPublishingRepository(opts.seed || []);
  }
  const filePath =
    opts.filePath ||
    process.env.PUBLISHING_DATA_FILE ||
    path.join(process.cwd(), "data", "publishing.json");
  return new FilePublishingRepository(filePath);
}

module.exports = {
  PublishingRepository,
  InMemoryPublishingRepository,
  FilePublishingRepository,
  createRepositoryFromEnv,
};
