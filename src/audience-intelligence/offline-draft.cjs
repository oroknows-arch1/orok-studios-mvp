'use strict';

// Offline deterministic draft preparation: no model, network, or publishing calls.
const { validateDiscovery } = require('./offline-scout.cjs');

function prepareDraft(discovery, candidate, finding) {
  const gate = validateDiscovery(discovery);
  if (!gate.ok) return { status: 'BLOCKED', reason: gate.reason };
  if (!candidate || candidate.formationId !== discovery.formationId ||
      candidate.status !== 'NEEDS_HUMAN_RELEVANCE_REVIEW' ||
      !candidate.url || !candidate.id) {
    return { status: 'BLOCKED', reason: 'UNREVIEWED_OR_UNRELATED_CANDIDATE' };
  }
  if (!finding || typeof finding.claim !== 'string' || !finding.claim.trim() ||
      !Array.isArray(finding.sourceIds) || !finding.sourceIds.length ||
      !finding.sourceIds.every(id => discovery.sourceIds.includes(id))) {
    return { status: 'BLOCKED', reason: 'CLAIM_WITHOUT_SOURCE_MAPPING' };
  }
  if (finding.claim.includes('\n') || discovery.limitation.includes('\n')) {
    return { status: 'BLOCKED', reason: 'INVALID_COPY_FORMAT' };
  }
  const copy = [
    finding.claim.trim(),
    '',
    discovery.limitation.trim(),
    '',
    discovery.url
  ].join('\n');
  return {
    status: 'DRAFT_REQUIRES_OWNER_REVIEW',
    publishAuthorised: false,
    candidateId: candidate.id,
    conversationUrl: candidate.url,
    formationId: discovery.formationId,
    text: copy,
    claims: [{ text: finding.claim.trim(), sourceIds: [...finding.sourceIds] }],
    limitations: discovery.limitation,
    sourceUrl: discovery.url,
    revision: 1
  };
}
module.exports = { prepareDraft };
