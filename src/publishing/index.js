"use strict";

const path = require("path");
const { createRepositoryFromEnv } = require("./repository");
const { PublishingService } = require("./service");
const { createPublishingRouter } = require("./routes");
const { PublishingGenerationService } = require("./generation-service");

/**
 * Create and initialise the publishing subsystem (repository + service +
 * router). Returns the router (to mount at /api/publishing) plus the service
 * and a ready() promise that resolves once storage is initialised and seeded.
 *
 * When a `postGenerator` (PostGenerator interface) is supplied, Draft
 * Generation v0.4 endpoints are enabled under `/api/publishing/generate`.
 *
 * @param {object} [opts]
 * @param {import("./repository").PublishingRepository} [opts.repository]
 * @param {{ generatePosts: Function }} [opts.postGenerator]
 * @returns {{
 *   router: import("express").Router,
 *   service: PublishingService,
 *   generationService: PublishingGenerationService|null,
 *   ready: Promise<void>,
 *   close: () => Promise<void>
 * }}
 */
function createPublishing(opts = {}) {
  const repository = opts.repository || createRepositoryFromEnv(opts);
  const service = new PublishingService(repository);
  const generationService = new PublishingGenerationService({
    publishingService: service,
    postGenerator: opts.postGenerator || null,
  });
  const router = createPublishingRouter(service, { generationService });
  const ready = service.init();
  const close = () => repository.close();
  return { router, service, generationService, ready, close };
}

/** Absolute path to the bundled publishing UI (single-page HTML). */
const UI_FILE = path.join(__dirname, "ui", "index.html");

module.exports = { createPublishing, UI_FILE };
