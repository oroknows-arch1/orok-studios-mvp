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

const candidateSpecificError = error => /^(?:X_FALLBACK_EVIDENCE_MISMATCH|V3_(?:UNSUPPORTED_EDITORIAL_CONNECTION|EDITORIAL_UNCERTAINTY_REQUIRED|ANALYTICAL_FINDING_REQUIRED|EDITORIAL_DRAFT_INVALID))$/.test(error?.message ?? '');

// Read actual attributable pages before attempting each distinct formation.
// A provider-wide fault aborts immediately, avoiding repeated paid attempts.
export async function writeXWithFormationFallback({input,readSource,write,limit=3}) {
  const originalIds = input.destination.evidence?.ids ?? [];
  let lastError = null;
  for (const candidate of xFormationCandidates(input.document,originalIds,limit)) {
    const sourcePages = (await Promise.all(candidate.sourceUrls.map(readSource))).filter(Boolean);
    if (!sourcePages.length) continue;
    const destination={...input.destination,evidence:{...input.destination.evidence,ids:candidate.evidenceIds}};
    try {
      const asset=await write({...input,destination,sourcePages});
      if (asset?.story_record_id!==candidate.recordId || !asset.evidence_ids?.length ||
        asset.evidence_ids.some(id=>!candidate.evidenceIds.includes(id))) throw Error('X_FALLBACK_EVIDENCE_MISMATCH');
      return asset;
    } catch(error) {
      if (!candidateSpecificError(error)) throw error;
      lastError=error;
    }
  }
  if(lastError)throw lastError;
  // No primary website was readable. Produce a reviewable, scan-evidence-only
  // draft for the original eligible formation instead of a workflow placeholder.
  // This is not independent source-passage verification; the separate editorial
  // status must continue to disclose that limitation to the owner.
  const candidate=xFormationCandidates(input.document,originalIds,limit)[0];
  if(!candidate)throw Error('V3_VERIFIED_SOURCE_REQUIRED');
  const destination={...input.destination,evidence:{...input.destination.evidence,ids:candidate.evidenceIds}};
  const asset=await write({...input,destination,sourcePages:[]});
  if(asset?.story_record_id!==candidate.recordId||!asset.evidence_ids?.length||
    asset.evidence_ids.some(id=>!candidate.evidenceIds.includes(id)))throw Error('X_FALLBACK_EVIDENCE_MISMATCH');
  return asset;
}
