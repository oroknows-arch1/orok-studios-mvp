"use strict";

const path = require("path");
const { createRepositoryFromEnv } = require("./repository");
const { PublishingService } = require("./service");
const { createPublishingRouter } = require("./routes");
const { LongGameEngine } = require("./long-game");
const { MastersOfYesterdayEngine } = require("./masters-of-yesterday");
const {
  DraftPreparationService,
  PublishingScheduler,
} = require("./schedule");

/**
 * Create and initialise the publishing capability of the original OROK app
 * (repository + service + router + Long Game + MoY + draft preparation).
 *
 * @param {object} [opts]
 */
function createPublishing(opts = {}) {
  const repository = opts.repository || createRepositoryFromEnv(opts);
  const service = new PublishingService(repository);
  const longGame = new LongGameEngine({ publishingService: service });
  const moy = new MastersOfYesterdayEngine({ publishingService: service });
  const preparation = new DraftPreparationService({
    publishingService: service,
    longGameEngine: longGame,
    moyEngine: moy,
    postGenerator: opts.postGenerator || null,
    timeZone: opts.timeZone,
  });
  const scheduler = new PublishingScheduler({
    preparation,
    intervalMs: opts.schedulerIntervalMs,
    logger: opts.logger,
  });
  const router = createPublishingRouter(service, {
    longGameEngine: longGame,
    moyEngine: moy,
    preparation,
    scheduler,
  });
  const ready = service.init().then(() => {
    if (opts.startScheduler !== false) {
      scheduler.start();
    }
  });
  const close = async () => {
    scheduler.stop();
    await repository.close();
  };
  return {
    router,
    service,
    longGame,
    moy,
    preparation,
    scheduler,
    ready,
    close,
  };
}

module.exports = { createPublishing };
