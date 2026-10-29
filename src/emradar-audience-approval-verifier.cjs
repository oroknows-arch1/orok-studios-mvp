'use strict';
const {createHash,timingSafeEqual}=require('node:crypto');
const {assetHash}=require('./emradar-audience-asset-hash.cjs');
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
function createAudienceApprovalVerifier({loadTrustedApproval,loadTrustedReview}={}){
 if(typeof loadTrustedApproval!=='function'||typeof loadTrustedReview!=='function')throw Error('TRUSTED_APPROVAL_READERS_REQUIRED');
 return async function verifyApprovedThread({campaign_id,approved_thread}={}){
  if(typeof campaign_id!=='string'||!campaign_id||!approved_thread||!Array.isArray(approved_thread.segments)||!approved_thread.segments.length)return false;
  const approval=await loadTrustedApproval(campaign_id);
  const review=await loadTrustedReview(campaign_id);
  if(!approval||!review||approval.status!=='APPROVED'||approval.actor_verified!==true||approval.campaign_id!==campaign_id||review.campaign_id!==campaign_id)return false;
  if(!same(approval.review_id,review.review_id)||!same(approval.source_sha256,review.source_sha256))return false;
  if(!Array.isArray(review.segments)||review.segments.length!==approved_thread.segments.length)return false;
  if(!Array.isArray(approval.approved_segment_hashes)||approval.approved_segment_hashes.length!==review.segments.length)return false;
  for(let i=0;i<review.segments.length;i++){
   const expected=review.segments[i],actual=approved_thread.segments[i];
   if(expected.sequence!==i+1||actual?.sequence!==i+1||expected.record_id!==actual.record_id||expected.kind!==actual.kind)return false;
   const hash=assetHash(actual);
   if(!same(hash,approval.approved_segment_hashes[i])||!same(hash,expected.asset_sha256))return false;
   if(actual.approval_status!=='APPROVED')return false;
  }
  return true;
 };
}
module.exports={createAudienceApprovalVerifier,sha};
