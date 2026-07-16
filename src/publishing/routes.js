"use strict";

const express = require("express");
const { ValidationError } = require("./validation");
const { TransitionError } = require("./transitions");

/**
 * Build an Express router for the publishing system, backed by the given
 * service instance. Mount at /api/publishing.
 *
 * @param {import("./service").PublishingService} service
 * @returns {import("express").Router}
 */
function createPublishingRouter(service) {
  const router = express.Router();

  const wrap = (handler) => async (req, res) => {
    try {
      await handler(req, res);
    } catch (err) {
      if (err instanceof ValidationError) {
        return res.status(400).json({ error: err.message, errors: err.errors });
      }
      if (err instanceof TransitionError) {
        return res.status(409).json({ error: err.message });
      }
      // eslint-disable-next-line no-console
      console.error("PUBLISHING ERROR:", err);
      return res.status(500).json({ error: err.message || "Internal error" });
    }
  };

  const notFound = (res) => res.status(404).json({ error: "Item not found" });

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
