"use strict";

/**
 * Repository interface for publishing items. Every storage backend (in-memory,
 * JSON file, PostgreSQL) implements this contract, so the service and route
 * layers never depend on a specific database.
 *
 *   Routes -> Publishing Service -> Publishing Repository Interface -> Adapter
 *
 * @interface
 */
class PublishingRepository {
  /** Perform any async setup. Must NOT destructively rewrite schema. */
  async init() {}

  /** Identify the backing store: "memory" | "file" | "postgres". */
  getStorageType() {
    return "unknown";
  }

  /**
   * List items, optionally filtered.
   * @param {{stream?:string,status?:string,date?:string,topic?:string,pattern?:string,publisher?:string,year?:string|number,source?:string}} [filter]
   * @returns {Promise<Array<object>>}
   */
  async list(_filter) {
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

  /**
   * Atomically read-modify-write a single item. Implementations must guarantee
   * the read, the mutator's decision, and the write happen without another
   * writer interleaving on the same item. The mutator receives the current
   * model and returns the next model, or null to abort (no write). Throwing
   * inside the mutator aborts the update and propagates the error.
   * @param {string} id
   * @param {(current: object) => (object|Promise<object>)} _mutator
   * @returns {Promise<object|null>}
   */
  async atomicUpdate(_id, _mutator) {
    throw new Error("not implemented");
  }

  /**
   * Storage readiness information (safe to expose publicly).
   * @returns {Promise<{ok:boolean, storage:string, databaseReachable:boolean, migrationsCurrent:boolean}>}
   */
  async health() {
    return {
      ok: true,
      storage: this.getStorageType(),
      databaseReachable: true,
      migrationsCurrent: true,
    };
  }

  /** Release any resources (connection pools, etc). */
  async close() {}
}

module.exports = { PublishingRepository };
