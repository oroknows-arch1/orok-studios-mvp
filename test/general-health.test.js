"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { createGeneralHealthHandler } = require("../src/health");

function startWith(deps) {
  const app = express();
  app.get("/health", createGeneralHealthHandler(deps));
  return new Promise((resolve) => {
    const server = app.listen(0, () =>
      resolve({ server, base: "http://127.0.0.1:" + server.address().port })
    );
  });
}

const okStorage = { ok: true, storage: "postgres", databaseReachable: true, migrationsCurrent: true };

/* 6. general /health success */
test("GET /health returns 200 when generator and storage are ready", async () => {
  const { server, base } = await startWith({
    service: { health: async () => okStorage },
    isGeneratorAvailable: () => true,
  });
  try {
    const res = await fetch(base + "/health");
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, "ok");
    assert.equal(body.process, "up");
    assert.equal(body.generator.available, true);
    assert.equal(body.publishing.ready, true);
    assert.equal(body.publishing.storage, "postgres");
  } finally {
    server.close();
  }
});

test("GET /health returns 503 when generator key is missing", async () => {
  const { server, base } = await startWith({
    service: { health: async () => okStorage },
    isGeneratorAvailable: () => false,
  });
  try {
    const res = await fetch(base + "/health");
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.equal(body.status, "degraded");
    assert.equal(body.generator.available, false);
  } finally {
    server.close();
  }
});

/* 7. general /health database failure */
test("GET /health returns 503 when the database is unreachable", async () => {
  const { server, base } = await startWith({
    service: {
      health: async () => ({
        ok: false,
        storage: "postgres",
        databaseReachable: false,
        migrationsCurrent: false,
      }),
    },
    isGeneratorAvailable: () => true,
  });
  try {
    const res = await fetch(base + "/health");
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.equal(body.publishing.databaseReachable, false);
    assert.equal(body.publishing.ready, false);
  } finally {
    server.close();
  }
});

/* 8. general /health migrations-behind response */
test("GET /health returns 503 when migrations are behind", async () => {
  const { server, base } = await startWith({
    service: {
      health: async () => ({
        ok: false,
        storage: "postgres",
        databaseReachable: true,
        migrationsCurrent: false,
      }),
    },
    isGeneratorAvailable: () => true,
  });
  try {
    const res = await fetch(base + "/health");
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.equal(body.publishing.databaseReachable, true);
    assert.equal(body.publishing.migrationsCurrent, false);
    assert.equal(body.status, "degraded");
  } finally {
    server.close();
  }
});

/* 14. no secrets in health output even when health() throws */
test("GET /health never leaks internals when service.health throws", async () => {
  const { server, base } = await startWith({
    service: {
      health: async () => {
        throw new Error("ECONNREFUSED 10.0.0.4:5432 password=topsecret /srv/data/publishing.json");
      },
    },
    isGeneratorAvailable: () => true,
  });
  try {
    const res = await fetch(base + "/health");
    const raw = await res.text();
    assert.equal(res.status, 503);
    assert.ok(!raw.includes("topsecret"));
    assert.ok(!raw.includes("ECONNREFUSED"));
    assert.ok(!raw.includes("/srv/data"));
  } finally {
    server.close();
  }
});
