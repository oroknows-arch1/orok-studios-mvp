"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  assertStorageAllowed,
  EMERGENCY_OVERRIDE,
} = require("../src/publishing/storage-policy");
const { createRepositoryFromEnv } = require("../src/publishing/repository");
const { assertDatabaseUrl } = require("../src/publishing/db/pool");

/* 2. production rejection of file storage */
test("production rejects file storage", () => {
  assert.throws(
    () => assertStorageAllowed("file", { NODE_ENV: "production" }),
    /not allowed when NODE_ENV=production/
  );
});

/* 3. production rejection of memory storage */
test("production rejects memory storage", () => {
  assert.throws(
    () => assertStorageAllowed("memory", { NODE_ENV: "production" }),
    /not allowed when NODE_ENV=production/
  );
});

test("postgres is allowed in production", () => {
  assert.doesNotThrow(() => assertStorageAllowed("postgres", { NODE_ENV: "production" }));
});

test("non-production allows file and memory", () => {
  assert.doesNotThrow(() => assertStorageAllowed("file", { NODE_ENV: "development" }));
  assert.doesNotThrow(() => assertStorageAllowed("memory", {}));
});

/* 4. emergency override defaults to disabled */
test("emergency override is disabled by default", () => {
  // no override set -> still throws
  assert.throws(
    () => assertStorageAllowed("file", { NODE_ENV: "production" }),
    new RegExp(EMERGENCY_OVERRIDE)
  );
  // a non-"true" value does not enable it
  assert.throws(
    () => assertStorageAllowed("file", { NODE_ENV: "production", [EMERGENCY_OVERRIDE]: "1" }),
    /not allowed/
  );
});

/* 5. safe emergency override warning */
test("emergency override permits ephemeral storage with a prominent warning", () => {
  const warnings = [];
  assert.doesNotThrow(() =>
    assertStorageAllowed(
      "file",
      { NODE_ENV: "production", [EMERGENCY_OVERRIDE]: "true" },
      { warn: (m) => warnings.push(m) }
    )
  );
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /EPHEMERAL/);
  assert.match(warnings[0], /NOT survive/);
});

test("factory enforces the production storage policy", () => {
  const saved = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    assert.throws(() => createRepositoryFromEnv({ mode: "file" }), /not allowed when NODE_ENV=production/);
    assert.throws(() => createRepositoryFromEnv({ mode: "memory" }), /not allowed when NODE_ENV=production/);
  } finally {
    if (saved === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = saved;
  }
});

/* 14. no secrets in errors (DATABASE_URL validation) */
test("DATABASE_URL validation errors never echo the connection string", () => {
  // wrong scheme, contains a 'password' we must never leak
  let msg = "";
  try {
    assertDatabaseUrl("http://user:sup3rs3cret@db.internal:5432/app");
  } catch (e) {
    msg = e.message;
  }
  assert.ok(msg.length > 0);
  assert.ok(!msg.includes("sup3rs3cret"), "must not leak password");
  assert.ok(!msg.includes("db.internal"), "must not leak host");
});
