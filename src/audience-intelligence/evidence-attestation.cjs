'use strict';
const { createHash } = require('node:crypto');
// Callers must retrieve immutable, published artifact bytes from the trusted
// publication/archive source. No caller-supplied 'attested' boolean is trusted.
function attestFromPublishedBytes(snapshot, { publishedBytes, scanUrl, formationId, sourceIds }) {
  const scan = snapshot?.payload?.scan;
  const decision = snapshot?.payload?.decisions?.x;
  const delivery = snapshot?.payload?.deliveries?.x;
  const expected = scan?.artifact_sha256;
  if (!Buffer.isBuffer(publishedBytes) || !/^[a-f0-9]{64}$/.test(expected || '') ||
      createHash('sha256').update(publishedBytes).digest('hex') !== expected ||
      !scan?.source_key?.endsWith(':' + expected) ||
      decision?.authority !== 'OWNER' || decision?.decision !== 'APPROVE' ||
      decision?.destination_id !== 'x' || decision?.campaign_id !== snapshot.campaign_id ||
      decision?.asset_sha256 !== snapshot?.payload?.assets?.x?.fingerprint &&
      decision?.asset_sha256 !== snapshot?.payload?.assets?.x?.asset?.sha256 ||
      delivery?.status !== 'ACCEPTED' || delivery?.receipt?.accepted !== true ||
      typeof scanUrl !== 'string' || !scanUrl.startsWith('https://') ||
      !formationId || !Array.isArray(sourceIds) || sourceIds.length === 0) {
    return { attested:false };
  }
  return { attested:true, campaignId:snapshot.campaign_id, ownerApprovedX:true,
    formationId, digest:expected, scanUrl, sourceIds:[...sourceIds] };
}
module.exports={attestFromPublishedBytes};
