"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { createPublishingRouter } = require("../src/publishing/routes");
const { createPool } = require("../src/publishing/db/pool");
const { PostgresPublishingRepository } = require("../src/publishing/db/postgres-repository");

function startWith(service) {
  const app = express();
  app.use(express.json());
  app.use("/api/publishing", createPublishingRouter(service));
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      resolve({ server, base: "http://127.0.0.1:" + server.address().port });
    });
  });
}

/* 16. health endpoint success */
test("health route returns 200 when storage is healthy", async () => {
  const service = {
    health: async () => ({ ok: true, storage: "memory", databaseReachable: true, migrationsCurrent: true }),
  };
  const { server, base } = await startWith(service);
  try {
    const res = await fetch(base + "/api/publishing/health");
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body, { ok: true, storage: "memory", databaseReachable: true, migrationsCurrent: true });
  } finally {
    server.close();
  }
});

/* 17. health endpoint safe failure response */
test("health route returns 503 with a safe body when storage is unhealthy", async () => {
  const service = {
    health: async () => ({ ok: false, storage: "postgres", databaseReachable: false, migrationsCurrent: false }),
  };
  const { server, base } = await startWith(service);
  try {
    const res = await fetch(base + "/api/publishing/health");
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.equal(body.databaseReachable, false);
    assert.deepEqual(Object.keys(body).sort(), ["databaseReachable", "migrationsCurrent", "ok", "storage"]);
  } finally {
    server.close();
  }
});

test("health route never leaks internals when health() throws", async () => {
  const service = {
    health: async () => {
      throw new Error("connect ECONNREFUSED 10.1.2.3:5432 password=supersecret /var/data/publishing.json");
    },
  };
  const { server, base } = await startWith(service);
  try {
    const res = await fetch(base + "/api/publishing/health");
    assert.equal(res.status, 503);
    const raw = await res.text();
    assert.ok(!raw.includes("ECONNREFUSED"));
    assert.ok(!raw.includes("supersecret"));
    assert.ok(!raw.includes("/var/data"));
    const body = JSON.parse(raw);
    assert.equal(body.ok, false);
  } finally {
    server.close();
  }
});

/* 17 (adapter-level). Postgres health degrades safely when DB is unreachable. */
test("postgres health reports unreachable DB without throwing or leaking", async () => {
  const pool = createPool("postgres://postgres@127.0.0.1:1/nope", {
    connectionTimeoutMillis: 1500,
  });
  const repo = new PostgresPublishingRepository(pool);
  try {
    const h = await repo.health();
    assert.equal(h.ok, false);
    assert.equal(h.storage, "postgres");
    assert.equal(h.databaseReachable, false);
    assert.equal(h.migrationsCurrent, false);
    assert.deepEqual(Object.keys(h).sort(), ["databaseReachable", "migrationsCurrent", "ok", "storage"]);
  } finally {
    await repo.close();
  }
});
