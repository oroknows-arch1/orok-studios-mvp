'use strict';

// Pure, offline engagement queue. A published post is a discovery anchor, never an
// autonomous publishing agent. No API access or external actions.
function buildEngagementQueue(anchor, candidates, { maxItems = 20 } = {}) {
  if (!anchor || anchor.published !== true || !anchor.postId ||
      !anchor.formationId || !/^https:\/\/(x\.com|twitter\.com)\/[A-Za-z0-9_]+\/status\/\d+$/.test(anchor.url || '')) {
    return { status: 'BLOCKED', reason: 'UNVERIFIED_X_ANCHOR', items: [] };
  }
  if (!Array.isArray(candidates)) throw new TypeError('candidates must be an array');
  const seen = new Set();
  const items = [];
  for (const c of candidates) {
    if (!c || c.formationId !== anchor.formationId ||
        c.status !== 'NEEDS_HUMAN_RELEVANCE_REVIEW' ||
        !c.id || !c.author || !c.url || c.id === anchor.postId || seen.has(c.id)) continue;
    seen.add(c.id);
    items.push({
      id: anchor.postId + ':' + c.id,
      anchorPostId: anchor.postId,
      conversationId: c.id,
      conversationUrl: c.url,
      account: c.author,
      origin: c.origin,
      evidenceIds: Array.isArray(c.sourceIds) ? [...c.sourceIds] : [],
      reason: 'Shared discovery terms; substantive relevance requires review',
      suggestedActions: ['REVIEW_CONVERSATION', 'CONSIDER_REPLY', 'CONSIDER_FOLLOW'],
      state: 'PENDING_HUMAN_REVIEW',
      actionAuthorised: false,
      replyText: null,
      lastObservedAt: c.observedAt || null
    });
  }
  return { status: 'REVIEW_QUEUE', items: items.slice(0, Math.max(0, Math.min(maxItems, 100))) };
}
module.exports = { buildEngagementQueue };
