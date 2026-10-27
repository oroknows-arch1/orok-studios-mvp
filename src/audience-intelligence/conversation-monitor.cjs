'use strict';

// Deterministic, offline observation reducer. No polling, network calls or outbound actions.
// Callers must persist returned state explicitly; input state is never mutated.
const ACTIONS = Object.freeze(['REVIEW_REPLY', 'REVIEW_FOLLOW', 'REVIEW_NEW_DISCUSSION']);
const validId = x => typeof x === 'string' && /^[0-9]{1,30}$/.test(x);
function reconcileObservations(anchor, previous = [], observations = [], { maxItems = 50 } = {}) {
  if (!anchor || anchor.published !== true || !validId(anchor.postId) || !anchor.formationId) {
    return { status: 'BLOCKED', reason: 'UNVERIFIED_ANCHOR', records: [], recommendations: [] };
  }
  if (!Array.isArray(previous) || !Array.isArray(observations)) throw new TypeError('arrays required');
  const records = new Map();
  for (const r of previous) {
    if (!r || !validId(r.postId) || !r.account || !r.observedAt || r.formationId !== anchor.formationId) continue;
    records.set(r.postId, { ...r, history: Array.isArray(r.history) ? r.history.map(x => ({...x})) : [] });
  }
  const recommendations = [];
  const sorted = observations.filter(Boolean).sort((a,b) => String(a.observedAt).localeCompare(String(b.observedAt)) || String(a.postId).localeCompare(String(b.postId)));
  for (const obs of sorted) {
    if (!validId(obs.postId) || obs.postId === anchor.postId ||
        obs.formationId !== anchor.formationId || !obs.account ||
        !Number.isFinite(Date.parse(obs.observedAt)) ||
        !['reply', 'mention', 'related'].includes(obs.kind)) continue;
    const old = records.get(obs.postId);
    if (old && Date.parse(obs.observedAt) <= Date.parse(old.observedAt)) continue;
    const counts = {};
    for (const key of ['likes','replies','views']) {
      counts[key] = Number.isSafeInteger(obs[key]) && obs[key] >= 0 ? obs[key] : null;
    }
    const snapshot = { observedAt: obs.observedAt, ...counts };
    const record = {
      postId: obs.postId, formationId: anchor.formationId,
      account: obs.account, kind: obs.kind, observedAt: obs.observedAt,
      history: [...(old?.history || []), snapshot].slice(-20),
      state: 'NEEDS_HUMAN_REVIEW', actionAuthorised: false
    };
    records.set(obs.postId, record);
    recommendations.push({
      postId: obs.postId, account: obs.account,
      action: obs.kind === 'related' ? 'REVIEW_NEW_DISCUSSION' : 'REVIEW_REPLY',
      followSuggestion: old ? null : 'REVIEW_FOLLOW',
      reason: old ? 'New observation of existing discussion' : 'New related conversation',
      authorised: false
    });
  }
  return {
    status: 'MONITORING_REVIEW_READY',
    records: [...records.values()].sort((a,b) => a.postId.localeCompare(b.postId)),
    recommendations: recommendations.slice(0, Math.max(0, Math.min(100, maxItems)))
  };
}
module.exports = { reconcileObservations, ACTIONS };
