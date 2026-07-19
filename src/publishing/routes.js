"use strict";

const express = require("express");
const { ValidationError } = require("./validation");
const { TransitionError } = require("./transitions");
const { SourceValidationError } = require("./long-game/sources");
const { LongGameEngine } = require("./long-game");
const {
  DraftPreparationService,
  PublishingScheduler,
  authorizePrepare,
  morningForWeekday,
  COFFEE_BREAK,
  SATURDAY_MIX_POOL,
  WEEKDAY_MORNING,
  localParts,
  resolveTimeZone,
} = require("./schedule");

/**
 * Build an Express router for publishing capability (mounted at /api/publishing).
 *
 * @param {import("./service").PublishingService} service
 * @param {object} [opts]
 */
function createPublishingRouter(service, opts = {}) {
  const router = express.Router();
  const longGame =
    opts.longGameEngine || new LongGameEngine({ publishingService: service });
  const preparation =
    opts.preparation ||
    new DraftPreparationService({
      publishingService: service,
      longGameEngine: longGame,
    });
  const scheduler =
    opts.scheduler ||
    new PublishingScheduler({ preparation, logger: () => {} });

  const wrap = (handler) => async (req, res) => {
    try {
      await handler(req, res);
    } catch (err) {
      if (err instanceof ValidationError || err instanceof SourceValidationError) {
        return res.status(400).json({ error: err.message, errors: err.errors });
      }
      if (err instanceof TransitionError) {
        return res.status(409).json({ error: err.message });
      }
      // eslint-disable-next-line no-console
      console.error("PUBLISHING ERROR:", err && err.message ? err.message : err);
      return res.status(500).json({ error: "Internal server error" });
    }
  };

  const notFound = (res) => res.status(404).json({ error: "Item not found" });

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
      const backfill =
        req.query.backfill === "1" || req.query.backfill === "true";
      let preparationResult = null;
      if (backfill) {
        preparationResult = await preparation.backfillToday({
          theme: req.query.theme,
        });
      }
      const dashboard = await service.dashboard({ today: req.query.today });
      res.json({
        ...dashboard,
        schedule: scheduler.status(),
        preparation: preparationResult,
        weekly: describeWeekly(),
      });
    })
  );

  router.get(
    "/schedule",
    wrap(async (_req, res) => {
      res.json({
        ...scheduler.status(),
        weekly: describeWeekly(),
        windows: {
          morningOrok: "05:00–06:00 local",
          coffeeBreakBuild: "15:00–18:00 local",
          sundayLongGame: "Saturday ≥12:00 or Sunday <12:00 local",
        },
      });
    })
  );

  router.get(
    "/weekly",
    wrap(async (_req, res) => {
      res.json(describeWeekly());
    })
  );

  router.get(
    "/weekly/resolve",
    wrap(async (req, res) => {
      const {
        morningForWeekday: mfw,
        COFFEE_BREAK: cbb,
        generatorCategoryFor: gcf,
        localParts: lp,
        resolveTimeZone: rtz,
      } = require("./schedule");
      const weekday = req.query.weekday
        ? Number(req.query.weekday)
        : lp(new Date(), rtz()).weekday;
      const morning = mfw(weekday);
      res.json({
        weekday,
        morning,
        coffeeBreak: weekday >= 1 && weekday <= 5 ? cbb : null,
        generatorCategory: morning ? gcf(morning.label) : null,
        timeZone: rtz(),
      });
    })
  );

  /**
   * Idempotent draft preparation. Protected by PUBLISHING_CRON_SECRET in
   * production. Also used by the in-app Today panel and optional Render cron.
   */
  router.post(
    "/prepare",
    wrap(async (req, res) => {
      const body = req.body || {};
      const secret =
        req.get("x-cron-secret") || body.secret || req.query.secret;
      if (!authorizePrepare(secret)) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      const result = await preparation.prepare({
        force: body.force === true,
        kinds: Array.isArray(body.kinds) ? body.kinds : undefined,
        theme: body.theme,
        coffeeBreakTheme: body.coffeeBreakTheme,
        developments: body.developments,
        now: body.now ? new Date(body.now) : undefined,
      });
      res.json(result);
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
    "/long-game/categories",
    wrap(async (_req, res) => {
      res.json({ categories: longGame.categories() });
    })
  );

  router.post(
    "/long-game/analyze",
    wrap(async (req, res) => {
      const brief = longGame.generateBrief(req.body || {});
      res.json({
        title: brief.title,
        familyLesson: brief.familyLesson,
        macroSignal: brief.macroSignal,
        dominantPattern: brief.dominantPattern,
        themes: brief.themes,
        sources: brief.sources,
        familyText: brief.familyText,
        xText: brief.xText,
        categoriesCovered: brief.categoriesCovered,
        noiseRemoved: brief.noiseRemoved,
      });
    })
  );

  router.post(
    "/long-game/generate",
    wrap(async (req, res) => {
      const body = req.body || {};
      const { brief, item, duplicateAdvisory } = await longGame.generateAndStore(
        {
          developments: body.developments,
          accessDate: body.accessDate,
          weekOf: body.weekOf || body.plannedDate,
        },
        {
          plannedDate: body.plannedDate || body.weekOf,
          status: body.status,
          notes: body.notes,
          surface: body.surface,
        }
      );
      res.status(201).json({ item, brief, duplicateAdvisory });
    })
  );

  router.get(
    "/items",
    wrap(async (req, res) => {
      const { stream, status, date, topic, pattern, publisher, year, source } =
        req.query;
      const items = await service.listItems({
        stream,
        status,
        date,
        topic,
        pattern,
        publisher,
        year,
        source,
      });
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

  /** Save a generated post from the original Create Post flow into the ledger. */
  router.post(
    "/save-from-generator",
    wrap(async (req, res) => {
      const body = req.body || {};
      const category = body.category || "OROK";
      const stream = resolveStreamForCategory(category, body.stream);
      const result = await service.createDraft({
        stream,
        plannedDate: body.plannedDate || new Date().toISOString().slice(0, 10),
        status: "draft",
        category,
        topic: body.topic || body.idea || category,
        text: body.text || "",
        imageRequired: body.imageRequired === true,
        imageBrief: body.imageBrief,
        notes: body.notes || "Saved from Create Post.",
        dominantPattern: body.dominantPattern,
        macroSignal: body.macroSignal,
        familyLesson: body.familyLesson,
        sources: body.sources,
        seriesNumber: body.seriesNumber,
      });
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
      const item = await service[method](
        req.params.id,
        ...transitionArgs(method, req)
      );
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

function transitionArgs(_method, _req) {
  return [];
}

function describeWeekly() {
  const parts = localParts(new Date(), resolveTimeZone());
  const today = morningForWeekday(parts.weekday);
  return {
    timeZone: resolveTimeZone(),
    todayWeekday: parts.weekday,
    today: today,
    coffeeBreak: COFFEE_BREAK,
    saturdayMixPool: SATURDAY_MIX_POOL,
    calendar: WEEKDAY_MORNING,
  };
}

function resolveStreamForCategory(category, explicit) {
  if (explicit) return explicit;
  const c = String(category || "").toLowerCase();
  if (c.includes("long game")) return "sunday-long-game";
  if (c.includes("coffee break")) return "coffee-break-build";
  if (c.includes("saturday") || c.includes("mixed")) return "saturday-mixed";
  return "orok-morning";
}

module.exports = { createPublishingRouter };
