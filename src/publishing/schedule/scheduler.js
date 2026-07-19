"use strict";

const { DraftPreparationService } = require("./prepare");
const { resolveTimeZone, localParts } = require("./timezone");

/**
 * Lightweight in-process scheduler for draft preparation.
 * Runs inside the existing web process (no second Render service required).
 * Idempotent ticks + protected HTTP prepare endpoint for manual/cron triggers.
 */
class PublishingScheduler {
  /**
   * @param {{
   *   preparation: DraftPreparationService,
   *   intervalMs?: number,
   *   logger?: (msg: string) => void,
   * }} deps
   */
  constructor(deps) {
    this.preparation = deps.preparation;
    this.intervalMs = deps.intervalMs || Number(process.env.PUBLISHING_SCHEDULER_INTERVAL_MS) || 60_000;
    this.logger = deps.logger || ((msg) => console.log(msg));
    this._timer = null;
    this._running = false;
    this._lastTick = null;
    this._lastResult = null;
  }

  start() {
    if (this._timer) return;
    const enabled = process.env.PUBLISHING_SCHEDULER !== "0";
    if (!enabled) {
      this.logger("PUBLISHING SCHEDULER: disabled (PUBLISHING_SCHEDULER=0)");
      return;
    }
    this.logger(
      `PUBLISHING SCHEDULER: started (interval ${this.intervalMs}ms, tz ${resolveTimeZone()})`
    );
    // Delay first tick slightly so boot can finish.
    this._timer = setInterval(() => {
      this.tick().catch((err) => {
        this.logger(
          "PUBLISHING SCHEDULER ERROR: " + (err && err.message ? err.message : err)
        );
      });
    }, this.intervalMs);
    if (typeof this._timer.unref === "function") this._timer.unref();
  }

  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  /**
   * One idempotent pass. Safe to call concurrently — overlaps are skipped.
   */
  async tick(opts = {}) {
    if (this._running) {
      return { ok: true, skipped: true, reason: "tick already in progress" };
    }
    this._running = true;
    try {
      const result = await this.preparation.prepare(opts);
      this._lastTick = new Date().toISOString();
      this._lastResult = result;
      if (result.created > 0) {
        this.logger(
          `PUBLISHING SCHEDULER: created ${result.created} draft(s) for ${result.localDate}`
        );
      }
      return result;
    } finally {
      this._running = false;
    }
  }

  status() {
    const parts = localParts(new Date(), resolveTimeZone());
    return {
      enabled: process.env.PUBLISHING_SCHEDULER !== "0",
      running: this._running,
      intervalMs: this.intervalMs,
      timeZone: resolveTimeZone(),
      localDate: parts.dateStr,
      localTime: `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`,
      lastTick: this._lastTick,
      lastResult: this._lastResult,
    };
  }
}

/**
 * Validate cron/prepare secret. Empty secret in non-production allows local use.
 * @param {string|undefined} provided
 * @returns {boolean}
 */
function authorizePrepare(provided) {
  const expected = process.env.PUBLISHING_CRON_SECRET || process.env.CRON_SECRET;
  if (!expected) {
    // No secret configured: allow in non-production only.
    return process.env.NODE_ENV !== "production";
  }
  return typeof provided === "string" && provided.length > 0 && provided === expected;
}

module.exports = {
  PublishingScheduler,
  DraftPreparationService,
  authorizePrepare,
};
