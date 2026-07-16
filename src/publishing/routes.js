"use strict";

const express = require("express");
const { ValidationError } = require("./validation");
const { TransitionError } = require("./transitions");
const { GenerationUnavailableError } = require("./generation-service");
const {
  EditorialResolutionError,
  EditorialValidationError,
  NeedsGroundingError,
} = require("../editorial");

/**
 * Build an Express router for the publishing system, backed by the given
 * service instance. Mount at /api/publishing.
 *
 * @param {import("./service").PublishingService} service
 * @param {{ generationService?: import("./generation-service").PublishingGenerationService }} [opts]
 * @returns {import("express").Router}
 */
function createPublishingRouter(service, opts = {}) {
  const router = express.Router();
  const generationService = opts.generationService || null;

  const wrap = (handler) => async (req, res) => {
    try {
      await handler(req, res);
    } catch (err) {
      if (
        err instanceof NeedsGroundingError ||
        err instanceof EditorialValidationError ||
        err instanceof EditorialResolutionError
      ) {
        return res.status(err.statusCode || 422).json({
          error: err.message,
          errors: err.errors || err.missing || [],
          code: err.code || err.name,
        });
      }
      if (err instanceof ValidationError) {
        const status = err.statusCode && err.statusCode !== 400 ? err.statusCode : 400;
        return res.status(status).json({
          error: err.message,
          errors: err.errors,
          code: err.code,
        });
      }
      if (err instanceof TransitionError) {
        return res.status(409).json({ error: err.message });
      }
      if (err instanceof GenerationUnavailableError) {
        return res.status(503).json({ error: err.message });
      }
      // Unexpected errors (e.g. database/driver errors) may contain SQL or
      // internal details, so log server-side only and return a generic message.
      // eslint-disable-next-line no-console
      console.error("PUBLISHING ERROR:", err && err.message ? err.message : err);
      return res.status(500).json({ error: "Internal server error" });
    }
  };

  const notFound = (res) => res.status(404).json({ error: "Item not found" });

  // Storage readiness. Returns only safe fields — never credentials, hostnames,
  // SQL, stack traces, or file paths. 200 when healthy, 503 otherwise.
  router.get("/health", async (req, res) => {
    try {
      const health = await service.health();
      res.status(health.ok ? 200 : 503).json(health);
    } catch (_err) {
      res.status(503).json({
        ok: false,
        storage: "unknown",
        databaseReachable: false,
        migrationsCurrent: false,
      });
    }
  });

  router.get(
    "/dashboard",
    wrap(async (req, res) => {
      res.json(await service.dashboard({ today: req.query.today }));
    })
  );

  router.get(
    "/next-number",
    wrap(async (req, res) => {
      const stream = req.query.stream || "coffee-break-build";
      const nextNumber = await service.suggestSeriesNumber(stream);
      res.json({ stream, nextNumber });
    })
  );

  router.post(
    "/check-duplicates",
    wrap(async (req, res) => {
      const advisory = await service.checkDuplicatesFor(req.body || {});
      res.json(advisory);
    })
  );

  // --- Draft Generation v0.4 (OROK editorial) -----------------------------
  // Resolve profile/surface/schedule without generating.
  router.post(
    "/generate/resolve",
    wrap(async (req, res) => {
      if (!generationService) {
        throw new GenerationUnavailableError();
      }
      res.json(generationService.resolveEditorial(req.body || {}));
    })
  );

  // Preview candidates (no publishing-item persistence). Never approves/publishes.
  // Refuses to run without a resolved OROK editorial profile.
  router.post(
    "/generate/preview",
    wrap(async (req, res) => {
      if (!generationService) {
        throw new GenerationUnavailableError();
      }
      const result = await generationService.preview(req.body || {});
      res.json(result);
    })
  );

  // Generate (or accept selected text) → validated draft → review queue.
  // Never auto-approves. Never marks published. Never calls X.
  router.post(
    "/generate",
    wrap(async (req, res) => {
      if (!generationService) {
        throw new GenerationUnavailableError();
      }
      const result = await generationService.generateDraft(req.body || {});
      res.status(201).json(result);
    })
  );

  router.get(
    "/items",
    wrap(async (req, res) => {
      const { stream, status, date, topic } = req.query;
      const items = await service.listItems({ stream, status, date, topic });
      res.json({ items, count: items.length });
    })
  );

  router.get(
    "/items/:id",
    wrap(async (req, res) => {
      const item = await service.getItem(req.params.id);
      if (!item) return notFound(res);
      res.json({ item });
    })
  );

  router.post(
    "/items",
    wrap(async (req, res) => {
      const result = await service.createDraft(req.body || {});
      res.status(201).json(result);
    })
  );

  router.patch(
    "/items/:id",
    wrap(async (req, res) => {
      const item = await service.updateItem(req.params.id, req.body || {});
      if (!item) return notFound(res);
      res.json({ item });
    })
  );

  const transition = (method) =>
    wrap(async (req, res) => {
      const item = await service[method](req.params.id, ...transitionArgs(method, req));
      if (!item) return notFound(res);
      res.json({ item });
    });

  router.post("/items/:id/submit", transition("submit"));
  router.post("/items/:id/approve", transition("approve"));
  router.post(
    "/items/:id/reject",
    wrap(async (req, res) => {
      const item = await service.reject(req.params.id, (req.body || {}).reason);
      if (!item) return notFound(res);
      res.json({ item });
    })
  );
  router.post(
    "/items/:id/publish",
    wrap(async (req, res) => {
      const item = await service.publish(req.params.id, req.body || {});
      if (!item) return notFound(res);
      res.json({ item });
    })
  );
  router.post("/items/:id/archive", transition("archive"));

  return router;
}

function transitionArgs(method, _req) {
  // submit/approve/archive take no extra args
  return [];
}

module.exports = { createPublishingRouter };
