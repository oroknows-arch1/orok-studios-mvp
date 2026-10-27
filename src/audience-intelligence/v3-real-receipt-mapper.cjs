'use strict';
// Actual V3 shape mapping, with injected provenance attestation.
// This module NEVER queries or writes V3; callers supply a read-only snapshot.
const { acceptPublishedXReceipt } = require('./v3-receipt-adapter.cjs');
function mapV3Snapshot(snapshot, verifiedResearch) {
  const x = snapshot?.payload?.deliveries?.x;
  const receipt = x?.receipt;
  if (!x || x.status !== 'ACCEPTED' || receipt?.accepted !== true ||
      !receipt.post_url || !receipt.provider_id || !receipt.receipt_id ||
      !verifiedResearch || verifiedResearch.attested !== true ||
      verifiedResearch.campaignId !== snapshot.campaign_id ||
      verifiedResearch.ownerApprovedX !== true ||
      !verifiedResearch.formationId || !verifiedResearch.digest ||
      !Array.isArray(verifiedResearch.sourceIds)) {
    return { status:'IGNORED', reason:'RECEIPT_OR_RESEARCH_NOT_ATTESTED' };
  }
  return acceptPublishedXReceipt({
    ownerApproved:true, distributionState:'PUBLISHED_CONFIRMED',
    provider:'X', xUrl:receipt.post_url, providerPostId:receipt.provider_id,
    receiptId:receipt.receipt_id, formationId:verifiedResearch.formationId,
    scanUrl:verifiedResearch.scanUrl, sourceIds:verifiedResearch.sourceIds,
    digest:verifiedResearch.digest
  });
}
module.exports = { mapV3Snapshot };
