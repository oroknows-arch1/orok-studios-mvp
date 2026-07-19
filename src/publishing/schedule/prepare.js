"use strict";

const { localParts, inWindow, resolveTimeZone } = require("./timezone");
const {
  morningForWeekday,
  COFFEE_BREAK,
  SATURDAY_MIX_POOL,
  generatorCategoryFor,
} = require("./weekly");
const { checkDuplicates } = require("../similarity");

/**
 * Preparation windows (local time):
 * - Morning OROK: 05:00–06:00
 * - Coffee Break Build: 15:00–18:00
 * - Sunday Long Game: Saturday ≥12:00 or Sunday <12:00
 */

/**
 * @param {import("../service").PublishingService} service
 * @param {object} [opts]
 */
class DraftPreparationService {
  /**
   * @param {{
   *   publishingService: import("../service").PublishingService,
   *   longGameEngine?: import("../long-game").LongGameEngine,
   *   postGenerator?: { generateBody?: Function } | null,
   *   timeZone?: string,
   * }} deps
   */
  constructor(deps) {
    if (!deps || !deps.publishingService) {
      throw new Error("DraftPreparationService requires publishingService");
    }
    this.publishingService = deps.publishingService;
    this.longGameEngine = deps.longGameEngine || null;
    this.postGenerator = deps.postGenerator || null;
    this.timeZone = resolveTimeZone(deps.timeZone);
  }

  /**
   * Idempotent preparation for the current local moment (or forced kinds).
   * Never publishes — drafts/ideas only.
   *
   * @param {{
   *   now?: Date,
   *   force?: boolean,
   *   kinds?: string[],
   *   theme?: string,
   *   developments?: object[],
   * }} [opts]
   */
  async prepare(opts = {}) {
    const now = opts.now || new Date();
    const parts = localParts(now, this.timeZone);
    const force = opts.force === true;
    const kinds = new Set(opts.kinds || []);
    const results = [];

    const wantMorning =
      force || kinds.has("morning") || inWindow(parts, 5, 0, 6, 0);
    const wantCbb =
      force || kinds.has("coffee-break") || inWindow(parts, 15, 0, 18, 0);
    const wantLongGame =
      force ||
      kinds.has("long-game") ||
      (parts.weekday === 6 && inWindow(parts, 12, 0, 24, 0)) ||
      (parts.weekday === 7 && inWindow(parts, 0, 0, 12, 0));

    // When force without kinds, prepare everything appropriate for the weekday.
    if (force && kinds.size === 0) {
      if (parts.weekday >= 1 && parts.weekday <= 6) {
        results.push(await this._ensureMorning(parts, opts));
      }
      if (parts.weekday >= 1 && parts.weekday <= 5) {
        results.push(await this._ensureCoffeeBreak(parts, opts));
      }
      if (parts.weekday === 6 || parts.weekday === 7) {
        results.push(await this._ensureLongGame(parts, opts));
      }
      return summarize(results, parts);
    }

    if (wantMorning && parts.weekday >= 1 && parts.weekday <= 6) {
      results.push(await this._ensureMorning(parts, opts));
    }
    if (wantCbb && parts.weekday >= 1 && parts.weekday <= 5) {
      results.push(await this._ensureCoffeeBreak(parts, opts));
    }
    if (wantLongGame) {
      results.push(await this._ensureLongGame(parts, opts));
    }

    return summarize(results, parts);
  }

  /**
   * Backfill missing drafts for "today" (dashboard open). Idempotent.
   */
  async backfillToday(opts = {}) {
    return this.prepare({ ...opts, force: true });
  }

  async _ensureMorning(parts, opts) {
    const plan = morningForWeekday(parts.weekday);
    if (!plan) return skipped("morning", "no plan for weekday");

    const plannedDate =
      plan.longGame || plan.stream === "sunday-long-game"
        ? sundayDateFor(parts)
        : parts.dateStr;

    if (plan.longGame || plan.stream === "sunday-long-game") {
      return this._ensureLongGame(parts, opts);
    }

    const existing = await this._findActive(plan.stream, plannedDate);
    if (existing) {
      return {
        kind: "morning",
        action: "exists",
        itemId: existing.id,
        stream: plan.stream,
        category: plan.label,
      };
    }

    if (plan.mixed) {
      return this._ensureSaturdayMixed(parts, opts);
    }

    const theme = (opts.theme && String(opts.theme).trim()) || "";
    const status = plan.requiresTheme && !theme ? "idea" : "draft";
    const topic =
      theme ||
      `${plan.label} — ${plan.requiresTheme ? "theme needed" : "prepared"}`;

    let text = "";
    if (theme && this.postGenerator && typeof this.postGenerator.generateBody === "function") {
      try {
        text = await this.postGenerator.generateBody({
          category: generatorCategoryFor(plan.label),
          idea: theme,
        });
      } catch (_e) {
        text = "";
      }
    }

    if (!text) {
      text = buildPlaceholderBody(plan, theme);
    }

    // Repetition guard (advisory → skip create if strong match on recent published)
    const dup = await this._recentRepeatRisk({
      stream: plan.stream,
      topic,
      text,
      category: plan.label,
    });
    if (dup.block) {
      return {
        kind: "morning",
        action: "skipped-repetition",
        reason: dup.reason,
        category: plan.label,
      };
    }

    const { item } = await this.publishingService.createDraft({
      stream: plan.stream,
      plannedDate,
      status,
      category: plan.label,
      topic,
      text,
      imageRequired: Boolean(plan.tributeManualImage),
      imageBrief: plan.tributeManualImage
        ? "Manual tribute image upload only — do not auto-generate a likeness."
        : undefined,
      notes: [
        plan.notes,
        plan.includeDadJoke ? "Also prepare Dad Joke Tuesday alongside the tribute." : "",
        plan.includeCookIslandsMaori
          ? "Include one valid Learn Cook Islands Māori episode."
          : "",
        `Prepared automatically (${this.timeZone}).`,
      ]
        .filter(Boolean)
        .join(" "),
    });

    return {
      kind: "morning",
      action: "created",
      itemId: item.id,
      stream: item.stream,
      category: plan.label,
      status: item.status,
    };
  }

  async _ensureSaturdayMixed(parts, opts) {
    const plannedDate = parts.dateStr;
    const existing = await this._findActive("saturday-mixed", plannedDate);
    if (existing) {
      return {
        kind: "saturday-mixed",
        action: "exists",
        itemId: existing.id,
      };
    }

    const choice = await this._pickSaturdayCategory(opts.theme);
    const topic = opts.theme
      ? `${choice}: ${opts.theme}`
      : `Saturday Mixed — ${choice}`;

    const { item } = await this.publishingService.createDraft({
      stream: "saturday-mixed",
      plannedDate,
      status: opts.theme ? "draft" : "idea",
      category: choice,
      topic,
      text: buildPlaceholderBody(
        { label: choice, notes: "Saturday mixed pick." },
        opts.theme || ""
      ),
      notes: `Saturday Mixed selection: ${choice}. Avoids recent repetition. Prepared (${this.timeZone}).`,
    });

    return {
      kind: "saturday-mixed",
      action: "created",
      itemId: item.id,
      category: choice,
    };
  }

  async _ensureCoffeeBreak(parts, opts) {
    const plannedDate = parts.dateStr;
    const existing = await this._findActive(COFFEE_BREAK.stream, plannedDate);
    if (existing) {
      return {
        kind: "coffee-break",
        action: "exists",
        itemId: existing.id,
        seriesNumber: existing.seriesNumber,
      };
    }

    const theme =
      (opts.theme && String(opts.theme).trim()) ||
      (opts.coffeeBreakTheme && String(opts.coffeeBreakTheme).trim()) ||
      "";

    const seriesNumber = await this.publishingService.suggestSeriesNumber(
      COFFEE_BREAK.stream
    );

    const topic = theme
      ? `Coffee Break Build #${String(seriesNumber).padStart(3, "0")} — ${theme}`
      : `Coffee Break Build #${String(seriesNumber).padStart(3, "0")}`;

    const dup = await this._recentRepeatRisk({
      stream: COFFEE_BREAK.stream,
      topic,
      text: theme,
      category: COFFEE_BREAK.label,
    });
    if (dup.block && theme) {
      return {
        kind: "coffee-break",
        action: "skipped-repetition",
        reason: dup.reason,
      };
    }

    const { item } = await this.publishingService.createDraft({
      stream: COFFEE_BREAK.stream,
      seriesNumber,
      plannedDate,
      status: theme ? "draft" : "idea",
      category: COFFEE_BREAK.label,
      topic,
      text: theme
        ? `Coffee Break Build focus: ${theme}. Ship one small, useful piece today.`
        : "Coffee Break Build — topic to confirm before review.",
      notes: `${COFFEE_BREAK.notes} Prepared in 15:00–18:00 window (${this.timeZone}).`,
    });

    return {
      kind: "coffee-break",
      action: "created",
      itemId: item.id,
      seriesNumber: item.seriesNumber,
    };
  }

  async _ensureLongGame(parts, opts) {
    const plannedDate = sundayDateFor(parts);
    const existing = await this._findActive("sunday-long-game", plannedDate);
    if (existing) {
      return {
        kind: "long-game",
        action: "exists",
        itemId: existing.id,
        sources: (existing.sources || []).length,
      };
    }

    if (!this.longGameEngine) {
      return skipped("long-game", "LongGameEngine not configured");
    }

    const { item, brief } = await this.longGameEngine.generateAndStore(
      {
        developments: opts.developments || [],
        accessDate: parts.dateStr,
        weekOf: plannedDate,
      },
      {
        plannedDate,
        status: "draft",
        notes: `Auto-prepared Long Game brief (${this.timeZone}).`,
        surface: "family",
      }
    );

    return {
      kind: "long-game",
      action: "created",
      itemId: item.id,
      sources: (brief.sources || item.sources || []).length,
      dominantPattern: item.dominantPattern,
    };
  }

  async _findActive(stream, plannedDate) {
    const items = await this.publishingService.listItems({
      stream,
      date: plannedDate,
    });
    const active = new Set([
      "idea",
      "draft",
      "review",
      "approved",
      "published",
    ]);
    return items.find((i) => active.has(i.status)) || null;
  }

  async _pickSaturdayCategory(themeHint) {
    const all = await this.publishingService.listItems({});
    const recent = all
      .filter((i) => i.status === "published" || i.status === "approved")
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
      .slice(0, 12);
    const recentCats = new Set(
      recent.map((i) => (i.category || "").toLowerCase()).filter(Boolean)
    );

    const pool = [...SATURDAY_MIX_POOL];
    // Prefer categories not seen recently
    const fresh = pool.filter((c) => !recentCats.has(c.toLowerCase()));
    const choices = fresh.length ? fresh : pool;
    if (themeHint && /wisdom|still/i.test(themeHint)) {
      const hit = choices.find((c) => /wisdom/i.test(c));
      if (hit) return hit;
    }
    // Deterministic rotation by day-of-year
    const day = localParts(new Date(), this.timeZone);
    const idx = (day.year * 372 + day.month * 31 + day.day) % choices.length;
    return choices[idx];
  }

  async _recentRepeatRisk(candidate) {
    const items = await this.publishingService.listItems({});
    const recent = items
      .filter((i) => i.status === "published" || i.status === "approved")
      .slice(0, 30);
    const advisory = checkDuplicates(candidate, recent);
    if (advisory.flagged && advisory.matches && advisory.matches[0]) {
      const top = advisory.matches[0];
      if ((top.matchedDimensions || []).length >= 3) {
        return {
          block: true,
          reason: `resembles “${top.topic}” on ${top.matchedDimensions.join(", ")}`,
        };
      }
    }
    // Soft topic equality
    const topic = (candidate.topic || "").toLowerCase().trim();
    if (
      topic &&
      recent.some((i) => (i.topic || "").toLowerCase().trim() === topic)
    ) {
      return { block: true, reason: `topic already used recently: ${candidate.topic}` };
    }
    return { block: false };
  }
}

function sundayDateFor(parts) {
  // If Sat, Long Game targets the upcoming Sunday; if Sun, today.
  if (parts.weekday === 7) return parts.dateStr;
  if (parts.weekday === 6) {
    return shiftDateStr(parts.dateStr, 1);
  }
  // Other weekdays forcing long-game: next Sunday
  const delta = 7 - parts.weekday;
  return shiftDateStr(parts.dateStr, delta);
}

function shiftDateStr(dateStr, days) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function buildPlaceholderBody(plan, theme) {
  const label = plan.label || "OROK";
  if (theme) {
    return `${label}\n\nTheme: ${theme}\n\nDraft prepared for review. Edit, approve, then publish manually.`;
  }
  return `${label}\n\nAwaiting theme or focus. This draft was prepared automatically and needs a human edit before review.`;
}

function skipped(kind, reason) {
  return { kind, action: "skipped", reason };
}

function summarize(results, parts) {
  const flat = results.filter(Boolean);
  return {
    ok: true,
    timeZone: resolveTimeZone(),
    localDate: parts.dateStr,
    localWeekday: parts.weekday,
    localTime: `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`,
    results: flat,
    created: flat.filter((r) => r.action === "created").length,
    existed: flat.filter((r) => r.action === "exists").length,
  };
}

module.exports = {
  DraftPreparationService,
  sundayDateFor,
  shiftDateStr,
};
