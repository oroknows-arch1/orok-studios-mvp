// Select distinct scanner-supported formations for X without inventing new evidence.
// The existing source-page and exact-claim editorial checks remain authoritative.
export function xFormationCandidates(document, originalIds = [], limit = 5) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 8) throw Error('X_FALLBACK_LIMIT_INVALID');
  const groups = new Map();
  for (const item of document?.evidence ?? []) {
    if (item?.verified !== true || typeof item.id !== 'string' || !item.id || !/^https:\/\//.test(item.source_url ?? '')) continue;
    const recordId = item.record_id ?? item.id.split(':')[0];
    if (!recordId) continue;
    if (!groups.has(recordId)) groups.set(recordId, {recordId, evidenceIds: [], sourceUrls: [], linked: 0});
    const group = groups.get(recordId);
    group.evidenceIds.push(item.id);
    if (!group.sourceUrls.includes(item.source_url)) group.sourceUrls.push(item.source_url);
    if (originalIds.includes(item.id)) group.linked++;
  }
  return [...groups.values()]
    .sort((a, b) => b.linked - a.linked || b.evidenceIds.length - a.evidenceIds.length || a.recordId.localeCompare(b.recordId))
    .slice(0, limit)
    .map(({recordId, evidenceIds, sourceUrls}) => ({recordId, evidenceIds, sourceUrls}));
}
