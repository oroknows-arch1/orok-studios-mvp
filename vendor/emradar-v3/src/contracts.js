import recipientPolicy from '../../../src/emradar-v3-recipient.cjs';
import { createHash } from 'node:crypto';

const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key,canonical(value[key])])) : value;
export const sha256 = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(canonical(value))).digest('hex');
export const MAX_DESTINATIONS = 30;
export const STATES = Object.freeze(['SCAN_VERIFIED','DESTINATIONS_SELECTED','ASSETS_PREPARED','PUBLICATION_REVIEW','OWNER_DECIDED','DISTRIBUTING','RECEIPTS_RECORDED','OUTCOMES_RECONCILED','CLOSED']);
export const DELIVERY = Object.freeze(['NOT_ATTEMPTED','ATTEMPTING','ACCEPTED','AMBIGUOUS','FAILED_DEFINITELY_UNSENT','CONFIRMED','REJECTED']);

export function assertScan(scan) {
  if (!scan || typeof scan !== 'object' || !/^\d{4}-\d{2}-\d{2}$/.test(scan.snapshot_date || '')) throw new Error('INVALID_SCAN_DATE');
  if (!/^[a-f0-9]{64}$/.test(scan.artifact_sha256 || '')) throw new Error('INVALID_SCAN_DIGEST');
  if (scan.publication_verified !== true || scan.live_artifact_sha256 !== scan.artifact_sha256 || scan.archive_artifact_sha256 !== scan.artifact_sha256) throw new Error('UNVERIFIED_PUBLICATION');
  return Object.freeze({ snapshot_date:scan.snapshot_date, artifact_sha256:scan.artifact_sha256, source_key:scan.snapshot_date+':'+scan.artifact_sha256 });
}
export function assertDestinations(destinations) {
  if (!Array.isArray(destinations) || destinations.length > MAX_DESTINATIONS) throw new Error('DESTINATION_LIMIT');
  const ids = new Set();
  for (const d of destinations) {
    const verified=d?.id==='x'||recipientPolicy.verifiedDestination(d);
    if (!d || typeof d.id !== 'string' || !d.id.trim() || ids.has(d.id) || !d.evidence || !verified) throw new Error('INVALID_DESTINATION');
    ids.add(d.id);
  }
  return destinations;
}
export function assetFingerprint(asset) {
  if (!asset || typeof asset !== 'object' || !asset.destination_id || !asset.body || !asset.campaign_id) throw new Error('INVALID_ASSET');
  return sha256(asset);
}
export function assertApproval(asset, approval) {
  const fingerprint = assetFingerprint(asset);
  if (!approval || approval.decision !== 'APPROVE' || approval.authority !== 'OWNER' || approval.asset_sha256 !== fingerprint || approval.campaign_id !== asset.campaign_id || approval.destination_id !== asset.destination_id) throw new Error('OWNER_APPROVAL_REQUIRED');
  return fingerprint;
}
export function assertSendable({asset,approval,receipt}) {
  const fingerprint = assertApproval(asset,approval);
  if(asset.kind==='EMAIL')recipientPolicy.assertRecipientAllowed(asset);
  if (receipt && receipt.status !== 'FAILED_DEFINITELY_UNSENT' && receipt.status !== 'NOT_ATTEMPTED') throw new Error('DELIVERY_ALREADY_ATTEMPTED_OR_AMBIGUOUS');
  return sha256([asset.campaign_id,asset.destination_id,fingerprint]);
}
export function identicalEmailGroupKey(asset) {
  if (asset.kind !== 'EMAIL') throw new Error('NOT_EMAIL');
  return sha256({subject:asset.subject,body:asset.body,from:asset.from,reply_to:asset.reply_to});
}
