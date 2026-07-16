"use strict";

/**
 * General application health for the deployed service (Render health check).
 *
 * Establishes, without making any external OpenAI calls:
 *   - the Express process is running
 *   - the generator application is available (its API key is configured)
 *   - the selected publishing storage is initialised
 *   - database readiness (when PostgreSQL is selected)
 *   - migration status
 *
 * Returns 200 only when the deployed app is ready to serve its intended
 * production functions; 503 when production storage is unavailable or
 * migrations are behind. Never exposes secrets, hostnames, file paths, SQL, or
 * stack traces.
 *
 * @param {{ service: { health: Function }, isGeneratorAvailable?: () => boolean }} deps
 * @returns {import("express").RequestHandler}
 */
function createGeneralHealthHandler(deps) {
  const service = deps.service;
  const isGeneratorAvailable =
    deps.isGeneratorAvailable || (() => Boolean(process.env.OPENAI_API_KEY));

  return async function healthHandler(req, res) {
    const generatorAvailable = Boolean(isGeneratorAvailable());

    let publishing;
    try {
      publishing = await service.health();
    } catch (_err) {
      publishing = {
        ok: false,
        storage: "unknown",
        databaseReachable: false,
        migrationsCurrent: false,
      };
    }

    const ready = generatorAvailable && publishing.ok === true;

    res.status(ready ? 200 : 503).json({
      status: ready ? "ok" : "degraded",
      process: "up",
      generator: { available: generatorAvailable },
      publishing: {
        storage: publishing.storage,
        ready: publishing.ok === true,
        databaseReachable: publishing.databaseReachable === true,
        migrationsCurrent: publishing.migrationsCurrent === true,
      },
    });
  };
}

module.exports = { createGeneralHealthHandler };
