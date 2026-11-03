'use strict';

// Offline-only candidate selector. No network, persistence, or publishing side effects.
const VALID_STATES = new Set(['INVESTIGATE', 'FORMING', 'CONFIRMED']);
const WORD = /[a-z0-9]+/g;
const terms = value => new Set((String(value || '').toLowerCase().match(WORD) || []).filter(x => x.length > 2));
const validUrl = value => {
  try { const u = new URL(value); return u.protocol === 'https:' && Boolean(u.hostname); }
  catch { return false; }
};

function validateDiscovery(d) {
  if (!d || d.published !== true || !validUrl(d.url) ||
      !d.formationId || !d.digest || !VALID_STATES.has(d.evidenceState) ||
      !Array.isArray(d.sourceIds) || !d.sourceIds.length ||
      !Array.isArray(d.keywords) || !d.keywords.length ||
      !Array.isArray(d.audiences) || !d.audiences.length ||
      typeof d.limitation !== 'string' || !d.limitation.trim()) {
    return { ok: false, reason: 'UNVERIFIED_PUBLISHED_DISCOVERY' };
  }
  return { ok: true };
}

function selectCandidates(discovery, posts, { minSharedTerms = 2, maxResults = 20 } = {}) {
  const gate = validateDiscovery(discovery);
  if (!gate.ok) return { status: 'BLOCKED', reason: gate.reason, candidates: [] };
  if (!Array.isArray(posts)) throw new TypeError('posts must be an array');
  const focus = terms(discovery.keywords.join(' '));
  const seen = new Set();
  const candidates = [];
  for (const post of posts) {
    if (!post || post.isReply === true || !validUrl(post.url) ||
        !/^https:\/\/(x\.com|twitter\.com)\/[A-Za-z0-9_]+\/status\/\d+$/.test(post.url) ||
        !post.id || !post.author || !post.observedAt || !post.createdAt ||
        !['watchlist', 'outside'].includes(post.origin) || seen.has(post.id)) continue;
    seen.add(post.id);
    const matched = [...terms(post.text)].filter(t => focus.has(t));
    if (matched.length < minSharedTerms) continue;
    const views = Number.isSafeInteger(post.views) && post.views >= 0 ? post.views : null;
    // Relevance is mandatory; virality is metadata, never a substitute.
    candidates.push({
      id: post.id, url: post.url, author: post.author, origin: post.origin,
      createdAt: post.createdAt, observedAt: post.observedAt,
      views, starred: views !== null && views >= 10000,
      sharedTerms: matched.sort(), relevanceScore: matched.length,
      formationId: discovery.formationId, sourceIds: [...discovery.sourceIds],
      status: 'NEEDS_HUMAN_RELEVANCE_REVIEW'
    });
  }
  candidates.sort((a,b) => b.relevanceScore-a.relevanceScore || a.id.localeCompare(b.id));
  return { status: 'CANDIDATES_FOR_REVIEW', candidates: candidates.slice(0, Math.max(0, Math.min(100, maxResults))) };
}
module.exports = { validateDiscovery, selectCandidates };
