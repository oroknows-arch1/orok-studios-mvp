"use strict";

const { Pool, types } = require("pg");

// Return DATE columns (OID 1082) as plain 'YYYY-MM-DD' strings rather than JS
// Date objects, so planned_date round-trips without timezone drift.
types.setTypeParser(1082, (value) => value);

/**
 * Validate a DATABASE_URL. Throws a clear, credential-free error when missing
 * or obviously malformed. Never includes the connection string in the message.
 * @param {string|undefined} url
 * @returns {string} the validated url
 */
function assertDatabaseUrl(url) {
  if (!url || typeof url !== "string" || url.trim() === "") {
    throw new Error(
      "PUBLISHING_STORAGE=postgres requires a DATABASE_URL environment variable. " +
        "Refusing to start the postgres adapter without it (no silent fallback)."
    );
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch (_err) {
    throw new Error(
      "DATABASE_URL is not a valid connection URL. Expected a postgres://... string."
    );
  }
  if (!/^postgres(ql)?:$/.test(parsed.protocol)) {
    throw new Error(
      "DATABASE_URL must use the postgres:// (or postgresql://) scheme."
    );
  }
  return url;
}

/**
 * Decide whether to enable TLS for the connection. Managed providers such as
 * Render require TLS; local development typically does not. Controlled by:
 *   - `sslmode=require` (or `disable`) in the URL
 *   - DATABASE_SSL=true|false override
 * Defaults to disabled for localhost, enabled otherwise.
 * @param {string} url
 */
function resolveSsl(url) {
  const parsed = new URL(url);
  const sslmode = parsed.searchParams.get("sslmode");
  if (sslmode === "disable") return false;
  if (sslmode === "require" || sslmode === "prefer" || sslmode === "verify-full") {
    return { rejectUnauthorized: false };
  }
  if (process.env.DATABASE_SSL === "true") return { rejectUnauthorized: false };
  if (process.env.DATABASE_SSL === "false") return false;
  const host = parsed.hostname;
  const isLocal = host === "localhost" || host === "127.0.0.1" || host === "::1";
  return isLocal ? false : { rejectUnauthorized: false };
}

/**
 * Create a pg Pool for the given connection string. Does NOT connect eagerly;
 * connection errors surface on first query (so a transient DB outage does not
 * crash unrelated parts of the app at startup).
 * @param {string} url
 * @param {object} [extra] extra pg.Pool options (e.g. max)
 * @returns {import("pg").Pool}
 */
function createPool(url, extra = {}) {
  assertDatabaseUrl(url);
  const pool = new Pool(
    Object.assign(
      {
        connectionString: url,
        ssl: resolveSsl(url),
        max: Number(process.env.PGPOOL_MAX || 10),
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000,
      },
      extra
    )
  );
  // Prevent an unhandled 'error' event on idle clients from crashing the process.
  pool.on("error", (err) => {
    // eslint-disable-next-line no-console
    console.error("PG POOL ERROR:", err.message);
  });
  return pool;
}

module.exports = { assertDatabaseUrl, resolveSsl, createPool };
