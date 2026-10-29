'use strict';
const {createHash,timingSafeEqual}=require('node:crypto');
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
function prepareDecisionPackage(review){
 if(review?.state!=='PREVIEW_ONLY'||!review.review_id||!Array.isArray(review.thread?.segments))throw Error('AUDIENCE_REVIEW_INVALID');
 const segments=review.thread.segments.map(s=>({sequence:s.sequence,kind:s.kind,record_id:s.record_id||null,text:s.text,asset_sha256:hash({sequence:s.sequence,kind:s.kind,record_id:s.record_id||null,text:s.text}),approval_status:'PENDING'}));
 return {review_id:review.review_id,source_sha256:review.source_sha256,state:'AWAITING_OWNER',segments,decision:null};
}
function recordOwnerDecision(pkg,{review_id,source_sha256,decisions,actor}={}){
 if(pkg?.state!=='AWAITING_OWNER'||actor!=='OWNER'||!Array.isArray(decisions))throw Error('AUDIENCE_OWNER_DECISION_REQUIRED');
 if(pkg.review_id!==review_id||pkg.source_sha256!==source_sha256||pkg.segments.length!==decisions.length)throw Error('AUDIENCE_DECISION_STALE');
 const approved=pkg.segments.map((segment,i)=>{
  const d=decisions[i];
  if(d?.sequence!==segment.sequence||d?.asset_sha256!==segment.asset_sha256||!['APPROVED','REJECTED'].includes(d?.decision))throw Error('AUDIENCE_DECISION_INVALID');
  return {...segment,approval_status:d.decision};
 });
 const allApproved=approved.every(s=>s.approval_status==='APPROVED');
 return {...pkg,state:allApproved?'APPROVED_FOR_FUTURE_RELEASE':'REVIEWED_WITH_REJECTIONS',segments:approved,decision:{actor:'OWNER',decision_sha256:hash(decisions)}};
}
module.exports={prepareDecisionPackage,recordOwnerDecision};
