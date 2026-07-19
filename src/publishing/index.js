"use strict";

const path = require("path");
const { createRepositoryFromEnv } = require("./repository");
const { PublishingService } = require("./service");
const { createPublishingRouter } = require("./routes");
const { LongGameEngine } = require("./long-game");

/**
 * Create and initialise the publishing subsystem (repository + service +
 * router). Returns the router (to mount at /api/publishing) plus the service
 * and a ready() promise that resolves once storage is initialised and seeded.
 *
 * @param {object} [opts]
 * @returns {{ router: import("express").Router, service: PublishingService, longGame: LongGameEngine, ready: Promise<void>, close: () => Promise<void> }}
 */
function createPublishing(opts = {}) {
  const repository = opts.repository || createRepositoryFromEnv(opts);
  const service = new PublishingService(repository);
  const longGame = new LongGameEngine({ publishingService: service });
  const router = createPublishingRouter(service, { longGameEngine: longGame });
  const ready = service.init();
  const close = () => repository.close();
  return { router, service, longGame, ready, close };
}

/** Absolute path to the bundled publishing UI (single-page HTML). */
const UI_FILE = path.join(__dirname, "ui", "index.html");

module.exports = { createPublishing, UI_FILE };
