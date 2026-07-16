"use strict";

const path = require("path");
const { createRepositoryFromEnv } = require("./repository");
const { PublishingService } = require("./service");
const { createPublishingRouter } = require("./routes");

/**
 * Create and initialise the publishing subsystem (repository + service +
 * router). Returns the router (to mount at /api/publishing) plus the service
 * and a ready() promise that resolves once storage is initialised and seeded.
 *
 * @param {object} [opts]
 * @returns {{ router: import("express").Router, service: PublishingService, ready: Promise<void> }}
 */
function createPublishing(opts = {}) {
  const repository = opts.repository || createRepositoryFromEnv(opts);
  const service = new PublishingService(repository);
  const router = createPublishingRouter(service);
  const ready = service.init();
  return { router, service, ready };
}

/** Absolute path to the bundled publishing UI (single-page HTML). */
const UI_FILE = path.join(__dirname, "ui", "index.html");

module.exports = { createPublishing, UI_FILE };
