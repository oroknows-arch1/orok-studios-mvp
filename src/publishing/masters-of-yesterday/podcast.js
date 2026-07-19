"use strict";

const {
  PODCAST_SEED,
  PODCAST_SHOW_ID,
  PODCAST_NAME,
  PODCAST_HOSTS,
} = require("./podcast-seed");

/**
 * Thursday Lingo — Learn Cook Islands Māori catalogue.
 * Hybrid: verified seed + optional iTunes refresh with seed fallback.
 */

let _runtimeCatalogue = null;
let _lastRefreshAt = null;

function getCatalogue() {
  return _runtimeCatalogue || PODCAST_SEED;
}

/**
 * Optionally refresh from Apple iTunes Lookup API. On failure, keep seed.
 * @param {{fetchImpl?: typeof fetch, limit?: number}} [opts]
 */
async function refreshCatalogue(opts = {}) {
  const doFetch = opts.fetchImpl || globalThis.fetch;
  if (typeof doFetch !== "function") {
    return { ok: false, reason: "fetch unavailable", catalogue: getCatalogue() };
  }
  try {
    const url = `https://itunes.apple.com/lookup?id=${PODCAST_SHOW_ID}&entity=podcastEpisode&limit=${opts.limit || 50}`;
    const res = await doFetch(url);
    if (!res.ok) throw new Error(`itunes status ${res.status}`);
    const data = await res.json();
    const eps = (data.results || [])
      .filter((r) => r.kind === "podcast-episode")
      .map((r) => ({
        id: String(r.trackId),
        podcastName: PODCAST_NAME,
        episodeTitle: r.trackName,
        episodeNumber: extractEpisodeNumber(r.trackName),
        applePodcastsUrl: String(r.trackViewUrl || "")
          .replace(/[?&]uo=\d+/g, "")
          .replace(/\?$/, ""),
        releaseDate: (r.releaseDate || "").slice(0, 10) || undefined,
        verificationStatus: "verified",
        lastVerifiedDate: new Date().toISOString().slice(0, 10),
      }))
      .filter((e) => e.applePodcastsUrl.includes("podcasts.apple.com") && e.applePodcastsUrl.includes("i="));
    if (eps.length < 2) throw new Error("too few episodes from itunes");
    _runtimeCatalogue = eps;
    _lastRefreshAt = new Date().toISOString();
    return { ok: true, catalogue: eps, refreshedAt: _lastRefreshAt };
  } catch (err) {
    return {
      ok: false,
      reason: err && err.message ? err.message : "refresh failed",
      catalogue: getCatalogue(),
    };
  }
}

function extractEpisodeNumber(title) {
  const m =
    String(title).match(/Lesson\s+(\d+(?:\.\d+)?)/i) ||
    String(title).match(/Bonus\s+(\d+(?:\.\d+)?)/i);
  return m ? m[1] : undefined;
}

/**
 * Deterministic shuffle cycle for episode selection.
 * Appears shuffled to users; stable for a given seed key.
 * @param {string} cycleKey e.g. rotation version + catalogue length
 */
function shuffledOrder(ids, cycleKey) {
  const arr = [...ids];
  let h = hash(cycleKey || "lingo");
  for (let i = arr.length - 1; i > 0; i--) {
    h = (h * 1664525 + 1013904223) >>> 0;
    const j = h % (i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Select one episode using shuffled cycle + history of recommended ids.
 * Persisted selection on the draft makes retries stable (caller stores result).
 *
 * @param {{usedEpisodeIds?: string[], cycleKey?: string}} [opts]
 */
function selectEpisode(opts = {}) {
  const catalogue = getCatalogue().filter(
    (e) =>
      e.verificationStatus === "verified" &&
      e.applePodcastsUrl &&
      /podcasts\.apple\.com/.test(e.applePodcastsUrl) &&
      /[?&]i=\d+/.test(e.applePodcastsUrl)
  );

  if (!catalogue.length) {
    return {
      ok: false,
      requiresReview: true,
      reason: "No verified Learn Cook Islands Māori episode catalogue available",
      thursdayLingo: {
        podcastName: PODCAST_NAME,
        hosts: PODCAST_HOSTS,
        status: "Requires Review",
        note: "Select an episode manually — do not invent titles or URLs.",
      },
    };
  }

  const used = new Set(opts.usedEpisodeIds || []);
  const order = shuffledOrder(
    catalogue.map((e) => e.id),
    opts.cycleKey || `lingo-${catalogue.length}`
  );

  let pickId = order.find((id) => !used.has(id));
  if (!pickId) {
    // Exhausted — least recently used: first in shuffle order (restart cycle)
    pickId = order[0];
  }
  const episode = catalogue.find((e) => e.id === pickId);

  return {
    ok: true,
    requiresReview: false,
    episode,
    thursdayLingo: {
      podcastName: PODCAST_NAME,
      hosts: PODCAST_HOSTS,
      episodeId: episode.id,
      episodeTitle: episode.episodeTitle,
      episodeNumber: episode.episodeNumber,
      applePodcastsUrl: episode.applePodcastsUrl,
      releaseDate: episode.releaseDate,
      verificationStatus: episode.verificationStatus,
      status: "ready",
    },
  };
}

function resetCatalogueForTests() {
  _runtimeCatalogue = null;
  _lastRefreshAt = null;
}

module.exports = {
  PODCAST_NAME,
  PODCAST_HOSTS,
  PODCAST_SHOW_ID,
  PODCAST_SEED,
  getCatalogue,
  refreshCatalogue,
  selectEpisode,
  shuffledOrder,
  resetCatalogueForTests,
};
