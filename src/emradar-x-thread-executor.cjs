'use strict';
// Isolated single-step publisher. No production route, scheduler or X client mounted.
function createThreadExecutor({store,verifyApprovedThread,publishPost}={}){
 if(typeof store?.reserve!=='function'||typeof store?.record!=='function'||typeof verifyApprovedThread!=='function'||typeof publishPost!=='function')throw Error('THREAD_EXECUTOR_DEPENDENCIES_REQUIRED');
 return async function publishNext({campaign_id,sequence,approved_thread}={}){
  if(!campaign_id||!Number.isInteger(sequence)||sequence<1||!approved_thread)throw Error('THREAD_EXECUTOR_INPUT_INVALID');
  // Verifier must independently check durable owner approval, asset hashes, full coverage,
  // graphic approvals, campaign identity and immutable thread snapshot.
  const verified=await verifyApprovedThread({campaign_id,approved_thread});
  if(verified!==true)throw Error('THREAD_APPROVAL_NOT_VERIFIED');
  const segment=approved_thread.segments?.[sequence-1];
  if(!segment||segment.sequence!==sequence||segment.approval_status!=='APPROVED'||typeof segment.text!=='string'||!segment.text.trim())throw Error('THREAD_SEGMENT_NOT_APPROVED');
  // Reserve BEFORE external side effects. No automatic retry after reservation.
  const reservation=await store.reserve({campaign_id,sequence});
  let result;
  try{
   result=await publishPost({campaign_id,sequence,text:segment.text,media:segment.media||null,parent_receipt_id:reservation.parent_receipt_id});
  }catch(error){
   await store.record({campaign_id,sequence,ambiguous:true});
   return {status:'HALTED_AMBIGUOUS',campaign_id,sequence,reason:'X_TRANSPORT_OUTCOME_UNCONFIRMED'};
  }
  const receipt_id=result?.receipt_id;
  if(result?.accepted!==true||!/^\d+$/.test(String(receipt_id||''))){
   await store.record({campaign_id,sequence,ambiguous:true});
   return {status:'HALTED_AMBIGUOUS',campaign_id,sequence,reason:'X_RECEIPT_UNCONFIRMED'};
  }
  const saved=await store.record({campaign_id,sequence,receipt_id:String(receipt_id)});
  return {status:'ACCEPTED',campaign_id,sequence,receipt_id:String(receipt_id),parent_receipt_id:reservation.parent_receipt_id,saved};
 };
}
module.exports={createThreadExecutor};
