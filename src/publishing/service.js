"use strict";

const { createItem, withHistorySnapshot } = require("./model");
const {
  ValidationError,
  assertValidItem,
  collectCreateErrors,
  collectPatchErrors,
  isNonEmptyString,
} = require("./validation");
const { assertTransition, TransitionError } = require("./transitions");
const { nextCoffeeBreakNumber, COFFEE_BREAK_STREAM } = require("./numbering");
const { checkDuplicates } = require("./similarity");
const { DEFAULT_RHYTHM } = require("./constants");

/** Stable id for the seeded Coffee Break Build #001 record. */
const SEED_CBB_001_ID = "seed-coffee-break-build-001";

/**
 * The publishing service holds all business rules and mediates between the
 * HTTP layer and the repository. Storage is injected so tests can use an
 * in-memory repository.
 */
class PublishingService {
  /** @param {import("./repository").PublishingRepository} repository */
  constructor(repository) {
    this.repo = repository;
  }

  async init() {
    await this.repo.init();
    await this.seedDefaults();
  }

  /**
   * Seed the confirmed Coffee Break Build #001 published record if it does not
   * already exist. Final text and URL are intentionally left unresolved.
   */
  async seedDefaults() {
    const existing = await this.repo.get(SEED_CBB_001_ID);
    if (existing) return existing;

    const already = (await this.repo.list()).some(
      (i) =>
        i.stream === COFFEE_BREAK_STREAM &&
        i.status === "published" &&
        i.seriesNumber === 1
    );
    if (already) return null;

    const seed = createItem({
      id: SEED_CBB_001_ID,
      stream: COFFEE_BREAK_STREAM,
      seriesNumber: 1,
      plannedDate: "2026-07-15",
      generatedAt: "2026-07-15T00:00:00.000Z",
      updatedAt: "2026-07-15T00:00:00.000Z",
      publishedAt: "2026-07-15T00:00:00.000Z",
      status: "published",
      topic: "Coffee Break Build #001",
      category: "Coffee Break Build",
      text: "",
      postUrl: "",
      imageRequired: false,
      notes:
        "Seeded record. Confirmed published on 2026-07-15. Final text and post URL are unresolved and must be filled in manually.",
      version: 1,
    });
    assertValidItem(seed);
    return this.repo.create(seed);
  }

  async listItems(filter = {}) {
    const items = await this.repo.list(filter || {});
    // newest planned first, then most recently updated
    items.sort((a, b) => {
      const byPlanned = String(b.plannedDate).localeCompare(String(a.plannedDate));
      if (byPlanned !== 0) return byPlanned;
      return String(b.updatedAt).localeCompare(String(a.updatedAt));
    });
    return items;
  }

  async getItem(id) {
    return this.repo.get(id);
  }

  /**
   * Suggest the next Coffee Break Build number (or null for other streams).
   * @param {string} stream
   */
  async suggestSeriesNumber(stream, options = {}) {
    if (stream !== COFFEE_BREAK_STREAM) return null;
    const items = await this.repo.list();
    return nextCoffeeBreakNumber(items, options);
  }

  /**
   * Run the advisory duplicate check for a candidate item shape.
   * @param {object} candidate
   */
  async checkDuplicatesFor(candidate) {
    const items = await this.repo.list();
    return checkDuplicates(candidate, items);
  }

  /**
   * Create a new draft/idea item. Never creates in an approved/published state.
   * @param {object} body
   * @returns {Promise<{item: object, duplicateAdvisory: object}>}
   */
  async createDraft(body) {
    const errors = collectCreateErrors(body);
    if (errors.length) throw new ValidationError("Invalid draft", errors);

    const requestedStatus = body.status || "draft";
    // Safety: creation may only ever produce an idea or draft. A brand-new item
    // can never be born approved or published.
    if (!["idea", "draft"].includes(requestedStatus)) {
      throw new ValidationError("Invalid draft", [
        "new items may only be created with status 'idea' or 'draft'",
      ]);
    }

    let seriesNumber = body.seriesNumber;
    if (body.stream === COFFEE_BREAK_STREAM && !Number.isInteger(seriesNumber)) {
      seriesNumber = await this.suggestSeriesNumber(COFFEE_BREAK_STREAM);
    }
    if (body.stream !== COFFEE_BREAK_STREAM) {
      seriesNumber = Number.isInteger(seriesNumber) ? seriesNumber : undefined;
    }

    const item = createItem({
      stream: body.stream,
      seriesNumber,
      plannedDate: body.plannedDate,
      status: requestedStatus,
      category: body.category,
      topic: body.topic,
      dominantPattern: body.dominantPattern,
      macroSignal: body.macroSignal,
      familyLesson: body.familyLesson,
      sources: body.sources,
      seriesMeta: body.seriesMeta,
      text: body.text,
      imageRequired: body.imageRequired,
      imageBrief: body.imageBrief,
      notes: body.notes,
      similarityKeys: body.similarityKeys,
    });

    assertValidItem(item);

    const duplicateAdvisory = await this.checkDuplicatesFor(item);
    const created = await this.repo.create(item);
    return { item: created, duplicateAdvisory };
  }

  /**
   * Edit editable fields of an item. Does NOT change status (use transitions).
   * Bumps version and records history when the text changes.
   * @param {string} id
   * @param {object} patch
   */
  async updateItem(id, patch) {
    const errors = collectPatchErrors(patch);
    if (errors.length) throw new ValidationError("Invalid update", errors);

    // The read-modify-write runs atomically under a row lock (postgres) so a
    // concurrent update cannot be silently overwritten.
    return this.repo.atomicUpdate(id, (current) => {
      // Published items must not be silently re-edited/renumbered.
      if (
        current.status === "published" &&
        patch.seriesNumber !== undefined &&
        patch.seriesNumber !== current.seriesNumber
      ) {
        throw new ValidationError("Invalid update", [
          "cannot renumber a published item",
        ]);
      }

      const next = { ...current };
      const editable = [
        "stream",
        "plannedDate",
        "category",
        "topic",
        "dominantPattern",
        "macroSignal",
        "familyLesson",
        "sources",
        "seriesMeta",
        "text",
        "imageRequired",
        "imageBrief",
        "notes",
        "seriesNumber",
      ];
      let textChanged = false;
      for (const field of editable) {
        if (patch[field] !== undefined) {
          if (field === "text" && patch.text !== current.text) textChanged = true;
          next[field] = patch[field];
        }
      }
      if (patch.similarityKeys && typeof patch.similarityKeys === "object") {
        next.similarityKeys = {
          ...current.similarityKeys,
          ...patch.similarityKeys,
        };
      }

      if (textChanged) {
        next.history = withHistorySnapshot(current);
        next.version = (current.version || 1) + 1;
      }
      next.updatedAt = new Date().toISOString();

      assertValidItem(next);
      return next;
    });
  }

  /**
   * Move an item into review. Legal from idea/draft.
   * @param {string} id
   */
  async submit(id) {
    return this._transition(id, "review");
  }

  /**
   * Approve an item. Legal only from review. Never auto-approves a generated
   * post — approval is always an explicit call to this method.
   * @param {string} id
   */
  async approve(id) {
    return this._transition(id, "approved");
  }

  /**
   * Reject an item, preserving it with a required reason.
   * @param {string} id
   * @param {string} reason
   */
  async reject(id, reason) {
    if (!isNonEmptyString(reason)) {
      throw new ValidationError("Rejection requires a reason", [
        "rejectionReason is required when rejecting an item",
      ]);
    }
    return this._transition(id, "rejected", (item) => {
      item.rejectionReason = reason.trim();
    });
  }

  /**
   * Publish an item. This is the ONLY path to `published` and requires the
   * explicit action of calling this method with confirmation. Legal only from
   * approved. Optionally records published date/time, post URL and final text.
   * @param {string} id
   * @param {{publishedAt?:string, postUrl?:string, text?:string, confirm?:boolean}} details
   */
  async publish(id, details = {}) {
    if (details.confirm === false) {
      throw new ValidationError("Explicit publication required", [
        "publishing requires explicit confirmation",
      ]);
    }

    // Defense-in-depth: refuse to publish a Coffee Break Build number that is
    // already published on another item. For postgres the authoritative
    // guarantee is the partial unique index (which also covers true concurrent
    // publishes); this pre-check provides a clean error and covers the
    // single-process memory/file adapters.
    const target = await this.repo.get(id);
    if (
      target &&
      target.stream === COFFEE_BREAK_STREAM &&
      Number.isInteger(target.seriesNumber)
    ) {
      const all = await this.repo.list();
      const clash = all.some(
        (i) =>
          i.id !== id &&
          i.stream === COFFEE_BREAK_STREAM &&
          i.status === "published" &&
          i.seriesNumber === target.seriesNumber
      );
      if (clash) {
        throw new TransitionError(
          `Coffee Break Build #${target.seriesNumber} is already published; refusing to duplicate the number.`
        );
      }
    }

    return this._transition(id, "published", (item) => {
      item.publishedAt = isNonEmptyString(details.publishedAt)
        ? details.publishedAt
        : new Date().toISOString();
      if (isNonEmptyString(details.postUrl)) item.postUrl = details.postUrl.trim();
      if (typeof details.text === "string" && details.text !== item.text) {
        item.history = withHistorySnapshot(item);
        item.text = details.text;
        item.version = (item.version || 1) + 1;
      }
    });
  }

  /**
   * Archive an item.
   * @param {string} id
   */
  async archive(id) {
    return this._transition(id, "archived");
  }

  /**
   * Internal transition helper: validates the transition, applies an optional
   * mutation, revalidates, and persists.
   * @param {string} id
   * @param {string} to
   * @param {(item: object) => void} [mutate]
   */
  async _transition(id, to, mutate) {
    return this.repo.atomicUpdate(id, (current) => {
      assertTransition(current.status, to);
      const next = {
        ...current,
        status: to,
        updatedAt: new Date().toISOString(),
      };
      if (typeof mutate === "function") mutate(next);
      assertValidItem(next);
      return next;
    });
  }

  /**
   * Storage readiness for the publishing subsystem (safe to expose).
   * @returns {Promise<{ok:boolean, storage:string, databaseReachable:boolean, migrationsCurrent:boolean}>}
   */
  async health() {
    return this.repo.health();
  }

  /**
   * Build the dashboard summary.
   * @param {{today?: string}} [opts] today override (ISO date) for testing
   */
  async dashboard(opts = {}) {
    const items = await this.repo.list();
    const now = opts.today ? new Date(opts.today) : new Date();
    const todayStr = toDateStr(now);

    const todaysItems = items.filter((i) => toDateStr(i.plannedDate) === todayStr);
    const morning = todaysItems.find((i) => i.stream === "orok-morning");
    const evening = todaysItems.find((i) => i.stream === "coffee-break-build");

    const awaitingReview = items.filter((i) => i.status === "review").length;
    const approved = items.filter((i) => i.status === "approved").length;

    const { start: weekStart, end: weekEnd } = weekBounds(now);
    const publishedThisWeek = items.filter((i) => {
      if (i.status !== "published" || !i.publishedAt) return false;
      const t = new Date(i.publishedAt).getTime();
      return t >= weekStart.getTime() && t <= weekEnd.getTime();
    }).length;

    const nextCoffeeBreakNumberValue = nextCoffeeBreakNumber(items);

    const recentActivity = [...items]
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
      .slice(0, 8)
      .map((i) => ({
        id: i.id,
        stream: i.stream,
        status: i.status,
        topic: i.topic,
        seriesNumber: i.seriesNumber,
        updatedAt: i.updatedAt,
      }));

    const weekday = now.getUTCDay() === 0 ? 7 : now.getUTCDay();
    const plannedRhythm = DEFAULT_RHYTHM[weekday];

    return {
      today: todayStr,
      weekday,
      plannedRhythm,
      morningPost: summarize(morning),
      eveningPost: summarize(evening),
      awaitingReview,
      approved,
      publishedThisWeek,
      nextCoffeeBreakNumber: nextCoffeeBreakNumberValue,
      recentActivity,
      totals: {
        all: items.length,
        byStatus: countBy(items, "status"),
        byStream: countBy(items, "stream"),
      },
    };
  }
}

function summarize(item) {
  if (!item) return null;
  return {
    id: item.id,
    stream: item.stream,
    status: item.status,
    topic: item.topic,
    seriesNumber: item.seriesNumber,
    imageRequired: item.imageRequired,
    characterCount: (item.text || "").length,
  };
}

function countBy(items, key) {
  const out = {};
  for (const i of items) {
    const k = i[key];
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}

function toDateStr(value) {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 10);
  return d.toISOString().slice(0, 10);
}

/** Monday 00:00:00 to Sunday 23:59:59.999 (UTC) around the given date. */
function weekBounds(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  const start = new Date(d);
  start.setUTCDate(d.getUTCDate() - (day - 1));
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);
  end.setUTCHours(23, 59, 59, 999);
  return { start, end };
}

module.exports = { PublishingService, SEED_CBB_001_ID };
