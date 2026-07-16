"use strict";

const path = require("path");
const { createRepositoryFromEnv } = require("./repository");
const { PublishingService } = require("./service");
const { createPublishingRouter } = require("./routes");
const { PublishingGenerationService } = require("./generation-service");
const { createCostRepositoryFromEnv } = require("./costs");

/**
 * Create and initialise the publishing subsystem (repository + service +
 * router + optional cost ledger). Returns the router (to mount at
 * /api/publishing) plus the service and a ready() promise that resolves once
 * storage is initialised and seeded.
 *
 * When a `postGenerator` (PostGenerator interface) is supplied, Draft
 * Generation v0.4 endpoints are enabled under `/api/publishing/generate`.
 * The cost ledger (v0.1) is observational and never gates generation.
 *
 * @param {object} [opts]
 * @param {import("./repository").PublishingRepository} [opts.repository]
 * @param {import("./costs/repository-interface").CostLedgerRepository} [opts.costRepository]
 * @param {{ generatePosts: Function }} [opts.postGenerator]
 * @param {import("pg").Pool} [opts.pool] shared postgres pool for items + costs
 * @returns {{
 *   router: import("express").Router,
 *   service: PublishingService,
 *   generationService: PublishingGenerationService,
 *   costRepository: import("./costs/repository-interface").CostLedgerRepository|null,
 *   ready: Promise<void>,
 *   close: () => Promise<void>
 * }}
 */
function createPublishing(opts = {}) {
  const repository = opts.repository || createRepositoryFromEnv(opts);

  // Prefer an explicit cost repo; otherwise mirror publishing storage mode.
  // When postgres and a pool was injected onto the items repo, reuse it.
  let costRepository =
    opts.costRepository !== undefined
      ? opts.costRepository
      : createCostRepositoryFromEnv({
          mode: opts.mode || process.env.PUBLISHING_STORAGE || repository.getStorageType(),
          pool: opts.pool || repository.pool,
          databaseUrl: opts.databaseUrl,
          filePath: opts.costFilePath,
          seed: opts.costSeed,
        });

  const service = new PublishingService(repository);
  const generationService = new PublishingGenerationService({
    publishingService: service,
    postGenerator: opts.postGenerator || null,
    costRepository,
  });
  const router = createPublishingRouter(service, { generationService });

  const ready = Promise.resolve()
    .then(() => (costRepository && costRepository.init ? costRepository.init() : undefined))
    .then(() => service.init());

  const close = async () => {
    if (costRepository && typeof costRepository.close === "function") {
      try {
        await costRepository.close();
      } catch (_e) {
        /* ignore */
      }
    }
    await repository.close();
  };

  return { router, service, generationService, costRepository, ready, close };
}

/** Absolute path to the bundled publishing UI (single-page HTML). */
const UI_FILE = path.join(__dirname, "ui", "index.html");

module.exports = { createPublishing, UI_FILE };
