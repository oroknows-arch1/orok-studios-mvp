"use strict";

const { listCategories, isKnownCategory } = require("./categories");
const { selectSources, PRIMARY_PUBLISHERS } = require("./sources");

/**
 * @typedef {Object} WeeklyDevelopment
 * @property {string} headline
 * @property {string} [summary]
 * @property {string} category
 * @property {string} [topic]
 * @property {Partial<import("./sources").LongGameSource>[]} [sources]
 * @property {number} [weight] optional importance 1–5
 */

/**
 * @typedef {Object} IntelligenceResult
 * @property {WeeklyDevelopment[]} developments
 * @property {string[]} themes
 * @property {string} dominantPattern
 * @property {string} macroSignal
 * @property {string} familyLesson
 * @property {string} title
 * @property {string} body
 * @property {string} bodyX
 * @property {import("./sources").LongGameSource[]} sources
 * @property {string[]} categoriesCovered
 * @property {string[]} noiseRemoved
 */

/**
 * Fallback primary-source catalogue used when operator-supplied developments
 * lack enough valid links. Prefer primary institutions.
 */
const FALLBACK_PRIMARY_SOURCES = Object.freeze([
  {
    title: "Reserve Bank of Australia — Media Releases",
    url: "https://www.rba.gov.au/media-releases/",
    publisher: "Reserve Bank of Australia",
  },
  {
    title: "Australian Bureau of Statistics — Latest Releases",
    url: "https://www.abs.gov.au/media-centre/media-releases",
    publisher: "Australian Bureau of Statistics",
  },
  {
    title: "Australian Treasury — News",
    url: "https://treasury.gov.au/news-media",
    publisher: "Treasury",
  },
  {
    title: "ASIC — News Centre",
    url: "https://asic.gov.au/about-asic/news-centre/",
    publisher: "ASIC",
  },
  {
    title: "Australian Government — News",
    url: "https://www.australia.gov.au/",
    publisher: "Australian Government",
  },
]);

/**
 * Collect and normalise weekly developments; drop empty/noisy entries.
 * @param {WeeklyDevelopment[]} raw
 * @returns {{developments: WeeklyDevelopment[], noiseRemoved: string[]}}
 */
function collectDevelopments(raw) {
  const noiseRemoved = [];
  const developments = [];
  for (const d of raw || []) {
    if (!d || typeof d !== "object") {
      noiseRemoved.push("non-object development");
      continue;
    }
    const headline = typeof d.headline === "string" ? d.headline.trim() : "";
    if (!headline || headline.length < 8) {
      noiseRemoved.push(headline || "(empty headline)");
      continue;
    }
    // Drop pure market-noise / hype / mortgage-framed items
    if (isNoise(headline, d.summary)) {
      noiseRemoved.push(headline);
      continue;
    }
    const category =
      typeof d.category === "string" && d.category.trim()
        ? d.category.trim()
        : "Markets";
    developments.push({
      headline,
      summary: typeof d.summary === "string" ? d.summary.trim() : undefined,
      category,
      topic: typeof d.topic === "string" ? d.topic.trim() : undefined,
      sources: Array.isArray(d.sources) ? d.sources : [],
      weight: Number.isFinite(d.weight) ? Number(d.weight) : 1,
    });
  }
  return { developments, noiseRemoved };
}

/**
 * Heuristic noise filter — hype, day-trading chatter, mortgage assumptions.
 * @param {string} headline
 * @param {string} [summary]
 */
function isNoise(headline, summary) {
  const text = `${headline} ${summary || ""}`.toLowerCase();
  const noisePatterns = [
    /\bget rich\b/,
    /\bto the moon\b/,
    /\bhype\b/,
    /\bday.?trad/,
    /\bmortgage\b/,
    /\bhot tip\b/,
    /\bguaranteed returns?\b/,
  ];
  return noisePatterns.some((re) => re.test(text));
}

/**
 * Identify recurring themes from category frequency and shared keywords.
 * @param {WeeklyDevelopment[]} developments
 * @returns {string[]}
 */
function identifyThemes(developments) {
  const counts = new Map();
  for (const d of developments) {
    const key = d.category || "Other";
    counts.set(key, (counts.get(key) || 0) + (d.weight || 1));
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name);
}

/**
 * Determine the week's dominant pattern from themes + headlines.
 * @param {WeeklyDevelopment[]} developments
 * @param {string[]} themes
 * @returns {string}
 */
function determineDominantPattern(developments, themes) {
  if (!developments.length) {
    return "Steady household focus amid a quiet news week";
  }
  const top = themes[0] || developments[0].category;
  const combined = developments.map((d) => d.headline).join(" ").toLowerCase();

  if (/cost of living|inflation|prices?|grocery|energy bill/.test(combined)) {
    return "Cost pressures are reshaping everyday family choices";
  }
  if (/employ|job|wage|hiring|unemploy/.test(combined)) {
    return "Work and income stability remain the household priority";
  }
  if (/ai|artificial intelligence|automat/.test(combined)) {
    return "AI is changing work skills families need to notice";
  }
  if (/rate|rba|interest|cash rate/.test(combined)) {
    return "Interest-rate signals are steering longer-term money habits";
  }
  if (/supply|trade|shipping|chain/.test(combined)) {
    return "Supply-chain shifts are showing up in prices and availability";
  }
  if (/energy|power|electric|renewable/.test(combined)) {
    return "Energy costs and transition plans are hitting family budgets";
  }
  if (/agricult|farm|drought|crop/.test(combined)) {
    return "Agricultural conditions are feeding through to food prices";
  }
  if (top === "Markets" || top === "Global Economy") {
    return "Global and market moves are a reminder to think long-term";
  }
  return `${top} developments are inviting calmer, longer-term family thinking`;
}

/**
 * Translate the dominant pattern into one practical family takeaway.
 * Calm, practical, optimistic. No mortgages, no regulated advice.
 * @param {string} dominantPattern
 * @param {WeeklyDevelopment[]} developments
 * @returns {string}
 */
function familyTakeaway(dominantPattern, developments) {
  const lower = dominantPattern.toLowerCase();
  if (lower.includes("cost")) {
    return "Review one recurring household expense this week and decide together what still earns its place.";
  }
  if (lower.includes("work") || lower.includes("income") || lower.includes("employ")) {
    return "Talk as a family about skills worth building — small, steady learning beats reacting to headlines.";
  }
  if (lower.includes("ai")) {
    return "Pick one useful tool to learn together this month; curiosity compounds better than fear.";
  }
  if (lower.includes("interest") || lower.includes("rate")) {
    return "Keep a simple cash buffer goal visible — calm preparation beats reacting to every rate headline.";
  }
  if (lower.includes("energy")) {
    return "Walk through this month's energy use once as a family and choose one practical saving habit.";
  }
  if (lower.includes("supply") || lower.includes("food") || lower.includes("agricult")) {
    return "Plan meals around staples you already trust; flexibility on brands beats chasing every price swing.";
  }
  if (developments[0]) {
    return "Take one calm household decision this week that still looks sensible a year from now.";
  }
  return "Protect a quiet weekly check-in on money and plans — consistency is the long game.";
}

/**
 * Compose title + family body from the week's intelligence.
 * @param {string} dominantPattern
 * @param {string} familyLesson
 * @param {WeeklyDevelopment[]} developments
 * @param {string[]} themes
 */
function composeCopy(dominantPattern, familyLesson, developments, themes) {
  const weekLabel = themes.slice(0, 2).join(" & ") || "the week";
  const title = `The Long Game: ${shortTitle(dominantPattern)}`;

  const lead =
    developments.length > 0
      ? `This week’s signal across ${weekLabel.toLowerCase()} points to a clearer pattern: ${lowercaseFirst(dominantPattern)}.`
      : `This was a quieter week for headline noise — which is still useful information for a family playing the long game.`;

  const evidence =
    developments.length > 0
      ? `A few developments stood out: ${developments
          .slice(0, 3)
          .map((d) => d.headline.replace(/\.$/, ""))
          .join("; ")}.`
      : `Without a single loud shock, the useful move is still the same: notice the pattern, then act calmly at home.`;

  const body = [
    lead,
    evidence,
    "None of this needs panic or jargon. Everyday families do best when big external moves become one practical habit at home — not a scramble to react.",
    `The takeaway this Sunday: ${lowercaseFirst(familyLesson)}`,
  ].join(" ");

  const bodyX = [
    lead,
    `The takeaway: ${lowercaseFirst(familyLesson)}`,
  ].join(" ");

  const macroSignal =
    developments[0]?.headline ||
    themes[0] ||
    "Quiet week — focus on household fundamentals";

  return { title, body, bodyX, macroSignal };
}

function shortTitle(pattern) {
  const cleaned = String(pattern || "")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length <= 72) return cleaned;
  return cleaned.slice(0, 69).trimEnd() + "…";
}

function lowercaseFirst(s) {
  if (!s) return s;
  return s.charAt(0).toLowerCase() + s.slice(1);
}

/**
 * Gather candidate sources from developments, then fill from primary catalogue.
 * @param {WeeklyDevelopment[]} developments
 * @param {{accessDate?: string}} [opts]
 */
function gatherSources(developments, opts = {}) {
  const accessDate = opts.accessDate || new Date().toISOString().slice(0, 10);
  const candidates = [];
  for (const d of developments) {
    for (const s of d.sources || []) {
      candidates.push({
        ...s,
        topic: s.topic || d.topic || d.headline,
        category: s.category || d.category,
        accessDate: s.accessDate || accessDate,
      });
    }
  }
  // Pad with primary fallbacks so every edition can meet the 2–5 rule.
  for (const fb of FALLBACK_PRIMARY_SOURCES) {
    candidates.push({ ...fb, accessDate });
  }
  return selectSources(candidates, { accessDate, preferPrimary: true });
}

/**
 * Full intelligence process for one weekly edition.
 *
 * 1. Collect relevant developments
 * 2. Identify recurring themes
 * 3. Determine the week's dominant pattern
 * 4. Translate into practical family decision making
 * 5. Generate the Long Game post content (family + X copy + sources)
 *
 * @param {{
 *   developments?: WeeklyDevelopment[],
 *   accessDate?: string,
 *   weekOf?: string,
 * }} input
 * @returns {IntelligenceResult}
 */
function runIntelligence(input = {}) {
  const accessDate =
    input.accessDate || new Date().toISOString().slice(0, 10);

  const { developments, noiseRemoved } = collectDevelopments(
    input.developments || []
  );
  const themes = identifyThemes(developments);
  const dominantPattern = determineDominantPattern(developments, themes);
  const familyLesson = familyTakeaway(dominantPattern, developments);
  const { title, body, bodyX, macroSignal } = composeCopy(
    dominantPattern,
    familyLesson,
    developments,
    themes
  );
  const sources = gatherSources(developments, { accessDate });

  const categoriesCovered = [
    ...new Set(
      developments
        .map((d) => d.category)
        .filter((c) => c && (isKnownCategory(c) || listCategories().includes(c)))
    ),
  ];

  return {
    developments,
    themes,
    dominantPattern,
    macroSignal,
    familyLesson,
    title,
    body,
    bodyX,
    sources,
    categoriesCovered,
    noiseRemoved,
  };
}

module.exports = {
  FALLBACK_PRIMARY_SOURCES,
  PRIMARY_PUBLISHERS,
  collectDevelopments,
  identifyThemes,
  determineDominantPattern,
  familyTakeaway,
  gatherSources,
  runIntelligence,
  isNoise,
};
