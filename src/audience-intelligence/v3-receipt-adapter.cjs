'use strict';

// Standalone downstream receipt adapter. Caller supplies read-only receipt snapshots.
// No V3 imports, database access, network calls, persistence or outbound actions.
const X_URL = /^https:\/\/(?:x\.com|twitter\.com)\/([A-Za-z0-9_]+)\/status\/([0-9]{1,30})$/;
function acceptPublishedXReceipt(receipt) {
  if (!receipt || typeof receipt !== 'object' || receipt.ownerApproved !== true ||
      receipt.distributionState !== 'PUBLISHED_CONFIRMED' ||
      receipt.provider !== 'X' || typeof receipt.xUrl !== 'string' ||
      typeof receipt.formationId !== 'string' || !receipt.formationId.trim() ||
      typeof receipt.receiptId !== 'string' || !receipt.receiptId.trim() ||
      typeof receipt.scanUrl !== 'string' || !/^https:\/\//.test(receipt.scanUrl) ||
      !Array.isArray(receipt.sourceIds) || !receipt.sourceIds.length ||
      typeof receipt.digest !== 'string' || !receipt.digest.trim()) {
    return { status: 'IGNORED', reason: 'NO_CONFIRMED_APPROVED_X_PUBLICATION' };
  }
  const match = X_URL.exec(receipt.xUrl);
  if (!match || String(receipt.providerPostId) !== match[2]) {
    return { status: 'IGNORED', reason: 'PROVIDER_POST_ID_MISMATCH' };
  }
  return {
    status: 'ELIGIBLE_DOWNSTREAM',
    job: {
      idempotencyKey: 'x:' + match[2],
      receiptId: receipt.receiptId,
      xPostId: match[2],
      xUrl: receipt.xUrl,
      formationId: receipt.formationId,
      scanUrl: receipt.scanUrl,
      sourceIds: [...receipt.sourceIds],
      digest: receipt.digest,
      status: 'PENDING_AUDIENCE_DISCOVERY',
      v3WriteAllowed: false,
      outboundActionAuthorised: false
    }
  };
}
function deriveAudienceJobs(receipts) {
  if (!Array.isArray(receipts)) throw new TypeError('receipt snapshots must be an array');
  const seen = new Set();
  const jobs = [];
  for (const receipt of receipts) {
    const result = acceptPublishedXReceipt(receipt);
    if (result.status !== 'ELIGIBLE_DOWNSTREAM' || seen.has(result.job.idempotencyKey)) continue;
    seen.add(result.job.idempotencyKey);
    jobs.push(result.job);
  }
  return { status: 'READ_ONLY_BATCH', jobs };
}
module.exports = { acceptPublishedXReceipt, deriveAudienceJobs };
