#!/usr/bin/env node
"use strict";

const { SEED_CBB_001_ID } = require("./service");

/**
 * Deployment smoke test against a running instance at a base URL.
 *
 * It exercises a controlled, non-destructive draft lifecycle and read-only
 * checks. It NEVER approves, publishes, calls X, calls image generation, calls
 * paid OpenAI generation (including `/api/publishing/generate`), or alters
 * Coffee Break Build #001. The controlled
 * draft is created on the `orok-morning` stream so it does not reserve a Coffee
 * Break Build number, and it is archived (not deleted, since deletion is not a
 * public workflow) and clearly labelled as a smoke-test record.
 *
 * @param {{ baseUrl: string, fetchImpl?: Function, logger?: Function }} opts
 * @returns {Promise<{ok: boolean, results: Array<{name:string, ok:boolean, detail?:string}>}>}
 */
async function runSmokeTest(opts) {
  const base = String(opts.baseUrl || "").replace(/\/+$/, "");
  const doFetch = opts.fetchImpl || globalThis.fetch;
  const log = opts.logger || (() => {});
  if (!base) throw new Error("--base-url is required");

  const results = [];
  const record = (name, ok, detail) => {
    results.push({ name, ok: !!ok, detail: detail || "" });
    log(`[${ok ? "PASS" : "FAIL"}] ${name}${detail ? " — " + detail : ""}`);
  };

  const testId = `smoke-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const topic = `[DEPLOYMENT SMOKE TEST ${testId}] safe automated check — do not publish`;

  const json = async (res) => {
    try {
      return await res.json();
    } catch (_e) {
      return {};
    }
  };

  // 1. general health
  let generatorAvailable = false;
  try {
    const r = await doFetch(base + "/health");
    const body = await json(r);
    generatorAvailable = !!(body.generator && body.generator.available);
    record("GET /health returns 200", r.status === 200, `status ${r.status}`);
  } catch (e) {
    record("GET /health returns 200", false, e.message);
  }

  // 2. generator UI
  try {
    const r = await doFetch(base + "/");
    const text = await r.text();
    record("GET / serves generator UI", r.status === 200 && /OROK Studios/.test(text));
  } catch (e) {
    record("GET / serves generator UI", false, e.message);
  }

  // 3. publishing UI
  try {
    const r = await doFetch(base + "/publishing");
    const text = await r.text();
    record("GET /publishing serves publishing UI", r.status === 200 && /Publishing/.test(text));
  } catch (e) {
    record("GET /publishing serves publishing UI", false, e.message);
  }

  // 4. publishing health
  try {
    const r = await doFetch(base + "/api/publishing/health");
    const body = await json(r);
    record("GET /api/publishing/health ok", r.status === 200 && body.ok === true);
  } catch (e) {
    record("GET /api/publishing/health ok", false, e.message);
  }

  // 5. generator availability WITHOUT calling generation (via /health flag)
  record(
    "generator available (no OpenAI call)",
    generatorAvailable,
    generatorAvailable ? "" : "generator.available was not true"
  );

  // 6. dashboard
  try {
    const r = await doFetch(base + "/api/publishing/dashboard");
    const body = await json(r);
    record(
      "publishing dashboard responds",
      r.status === 200 && typeof body.nextCoffeeBreakNumber === "number"
    );
  } catch (e) {
    record("publishing dashboard responds", false, e.message);
  }

  // 7. Coffee Break Build #001 presence (read-only, must not alter)
  try {
    const r = await doFetch(base + "/api/publishing/items/" + SEED_CBB_001_ID);
    const body = await json(r);
    const seed = body.item;
    record(
      "Coffee Break Build #001 present & published",
      r.status === 200 && seed && seed.status === "published" && seed.seriesNumber === 1
    );
  } catch (e) {
    record("Coffee Break Build #001 present & published", false, e.message);
  }

  // 8. create a controlled draft (orok-morning: does not reserve a CBB number)
  let draftId = null;
  try {
    const r = await doFetch(base + "/api/publishing/items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        stream: "orok-morning",
        plannedDate: new Date().toISOString().slice(0, 10),
        topic,
        category: "Deployment Smoke Test",
        text: "This is an automated deployment smoke-test draft. It is safe to archive/delete.",
        notes: `smoke-test:${testId}`,
      }),
    });
    const body = await json(r);
    draftId = body.item && body.item.id;
    record("create controlled draft", r.status === 201 && !!draftId);
  } catch (e) {
    record("create controlled draft", false, e.message);
  }

  // 9. retrieve the draft
  if (draftId) {
    try {
      const r = await doFetch(base + "/api/publishing/items/" + draftId);
      const body = await json(r);
      record("retrieve controlled draft", r.status === 200 && body.item && body.item.id === draftId);
    } catch (e) {
      record("retrieve controlled draft", false, e.message);
    }

    // 10. edit the draft
    try {
      const r = await doFetch(base + "/api/publishing/items/" + draftId, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "Edited by deployment smoke test. Safe to archive." }),
      });
      const body = await json(r);
      record("edit controlled draft", r.status === 200 && body.item && body.item.version >= 2);
    } catch (e) {
      record("edit controlled draft", false, e.message);
    }

    // 11. archive the draft (safest existing operation; deletion is not public)
    try {
      const r = await doFetch(base + "/api/publishing/items/" + draftId + "/archive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const body = await json(r);
      record(
        "archive controlled draft",
        r.status === 200 && body.item && body.item.status === "archived"
      );
    } catch (e) {
      record("archive controlled draft", false, e.message);
    }
  } else {
    record("retrieve controlled draft", false, "no draft id");
    record("edit controlled draft", false, "no draft id");
    record("archive controlled draft", false, "no draft id");
  }

  const ok = results.every((r) => r.ok);
  return { ok, results, testId };
}

function parseArgs(argv) {
  const out = { baseUrl: "" };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--base-url") out.baseUrl = argv[++i];
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.baseUrl) {
    console.error("Usage: npm run smoke:test -- --base-url https://your-service.onrender.com");
    process.exit(1);
  }
  try {
    const { ok, testId } = await runSmokeTest({ baseUrl: args.baseUrl, logger: (m) => console.log(m) });
    console.log(`\nSmoke-test record id: ${testId}`);
    console.log(ok ? "Smoke test passed." : "Smoke test FAILED.");
    process.exitCode = ok ? 0 : 1;
  } catch (err) {
    console.error("Smoke test error: " + (err && err.message ? err.message : "unknown"));
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = { runSmokeTest, parseArgs };
