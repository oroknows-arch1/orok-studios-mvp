"use strict";

/**
 * Production storage policy.
 *
 * In production, ephemeral storage (memory/file) must never be used by
 * accident: on Render the filesystem is wiped on every deploy/restart, so file
 * storage would silently lose every publish and approval. This policy enforces
 * that PUBLISHING_STORAGE=postgres in production, unless an operator explicitly
 * opts into an ephemeral store for emergency use.
 */

/** Environment variable that explicitly permits ephemeral storage in production. */
const EMERGENCY_OVERRIDE = "PUBLISHING_ALLOW_EPHEMERAL_STORAGE";

/** Storage modes that do not survive a Render restart. */
const EPHEMERAL_MODES = ["memory", "file"];

function isProduction(env) {
  return String(env.NODE_ENV || "").toLowerCase() === "production";
}

/** The emergency override is disabled by default; only "true" enables it. */
function ephemeralOverrideEnabled(env) {
  return String(env[EMERGENCY_OVERRIDE] || "").toLowerCase() === "true";
}

/**
 * Throw if the given storage mode is not permitted for the environment. When an
 * override is used in production, emit a prominent warning instead of throwing.
 *
 * @param {string} mode the resolved storage mode ("memory"|"file"|"postgres")
 * @param {NodeJS.ProcessEnv} [env]
 * @param {{ warn?: (msg: string) => void }} [opts]
 */
function assertStorageAllowed(mode, env = process.env, opts = {}) {
  const warn = opts.warn || ((m) => console.warn(m));
  if (!isProduction(env)) return;
  if (!EPHEMERAL_MODES.includes(mode)) return;

  if (!ephemeralOverrideEnabled(env)) {
    throw new Error(
      `Refusing to start: PUBLISHING_STORAGE="${mode}" is not allowed when NODE_ENV=production. ` +
        `Use PUBLISHING_STORAGE=postgres. To override for an emergency, set ${EMERGENCY_OVERRIDE}=true ` +
        `(ephemeral storage does NOT survive restarts).`
    );
  }

  warn(
    `WARNING: ${EMERGENCY_OVERRIDE} is enabled — running with EPHEMERAL "${mode}" storage in ` +
      `production. Publishing data will NOT survive a restart or redeploy. This is intended for ` +
      `emergency use only; switch back to PostgreSQL as soon as possible.`
  );
}

module.exports = {
  EMERGENCY_OVERRIDE,
  EPHEMERAL_MODES,
  isProduction,
  ephemeralOverrideEnabled,
  assertStorageAllowed,
};
