"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { createPool } = require("../src/publishing/db/pool");
const { PostgresPublishingRepository } = require("../src/publishing/db/postgres-repository");
const { createPublishing } = require("../src/publishing");

/* 15. graceful database-pool shutdown */
test("PostgresPublishingRepository.close() ends the connection pool", async () => {
  const pool = createPool("postgres://user@127.0.0.1:5432/db");
  const repo = new PostgresPublishingRepository(pool);
  assert.equal(pool.ended, false);
  await repo.close();
  assert.equal(pool.ended, true);
});

test("createPublishing(...).close() releases the postgres pool", async () => {
  const pool = createPool("postgres://user@127.0.0.1:5432/db");
  const { close, ready } = createPublishing({ mode: "postgres", pool });
  // seed/init will fail against this unused URL; that's fine here — swallow it.
  ready.catch(() => {});
  await close();
  assert.equal(pool.ended, true);
});

test("close() on memory/file adapters is a safe no-op", async () => {
  const mem = createPublishing({ mode: "memory" });
  await mem.ready;
  await mem.close(); // should not throw
  assert.ok(true);
});
