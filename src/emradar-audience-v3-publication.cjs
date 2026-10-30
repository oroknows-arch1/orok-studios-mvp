'use strict';
// Bounded continuation uses existing OAuth + verified media upload and the
// independent durable thread reservations. Ambiguous outcomes never reset.
function createV3ThreadPublication({campaignStore,threadStore,review,x,enabled=false,maxPostsPerRun=8}={}){
 if(!campaignStore?.mutate||!threadStore?.ensureRegistered||!review?.verify||!x?.prepareThreadPost||!Number.isInteger(maxPostsPerRun)||maxPostsPerRun<1||maxPostsPerRun>20)throw Error('THREAD_V3_DEPENDENCIES_REQUIRED');
 return async function run(campaign_id){
  if(!enabled)return {status:'DISABLED'};
  let state=(await campaignStore.adapter.read(campaign_id))?.value;
  const r=state?.audience_x_review,a=state?.audience_x_approval,c=state?.audience_x_checks;
  if(!r||!a||c?.manifest_sha256!==r.manifest_sha256||c.approval_id!==a.id||['completeness','exact_assets','authoritative_approval'].some(k=>c[k]!=='PASS')||!await review.verify({campaign_id,approved_thread:r}))throw Error('THREAD_V3_APPROVAL_NOT_VERIFIED');
  const segments=r.segments.map(s=>({...s,approval_status:'APPROVED'}));
  // Approval status is workflow metadata, excluded from each exact asset hash.
  await threadStore.ensureRegistered({campaign_id,approved_segments:segments});
  await campaignStore.mutate(campaign_id,current=>{
   if(current.audience_x_review?.manifest_sha256!==r.manifest_sha256||current.audience_x_approval?.id!==a.id||current.deliveries?.x)throw Error('THREAD_V3_AUTHORIZATION_CHANGED');
   current.audience_x_publication_started={manifest_sha256:r.manifest_sha256,approval_id:a.id};return current;
  });
  let sent=0;
  for(;sent<maxPostsPerRun;){
   const rows=await threadStore.list(campaign_id),pending=rows.find(row=>row.status!=='ACCEPTED');
   if(!pending){
    const outcome={status:'COMPLETE',manifest_sha256:r.manifest_sha256,thread_url:'https://x.com/i/web/status/'+rows[0].receipt_id,posts:rows.map(row=>({sequence:row.sequence,record_id:row.record_id,post_id:row.receipt_id,parent_post_id:row.parent_receipt_id,confirmed_at:row.updated_at}))};
    await campaignStore.mutate(campaign_id,current=>{current.audience_x_publication=outcome;return current;});return outcome;
   }
   if(!await review.verify({campaign_id,approved_thread:r}))throw Error('THREAD_V3_AUTHORIZATION_CHANGED');
   const segment=r.segments[pending.sequence-1];
   if(pending.status!=='PENDING'){
    const receipt=await x.reconcileThreadPost({segment,scan:r.scan,parent_receipt_id:pending.parent_receipt_id,upload:pending.provider_upload});
    if(receipt.status!=='VERIFIED_ACCEPTED')return {status:'HALTED_AMBIGUOUS',sequence:pending.sequence};
    await threadStore.reconcileAccepted({campaign_id,sequence:pending.sequence,receipt});continue;
   }
   const parent=pending.sequence===1?null:rows[pending.sequence-2].receipt_id;
   // Identity/history preflight occurs before reserving; it never uploads/posts.
   const prepared=await x.prepareThreadPost({segment,scan:r.scan,parent_receipt_id:parent});
   const reservation=await threadStore.reserve({campaign_id,sequence:pending.sequence});
   if(reservation.parent_receipt_id!==parent)throw Error('THREAD_V3_PARENT_CHANGED');
   let receipt;
   try{
    receipt=await prepared.publish({onMediaUploaded:upload=>threadStore.saveUpload({campaign_id,sequence:pending.sequence,upload})});
   }catch{
    await threadStore.record({campaign_id,sequence:pending.sequence,ambiguous:true});return {status:'HALTED_AMBIGUOUS',sequence:pending.sequence};
   }
   if(receipt?.accepted!==true||!/^\d+$/.test(receipt.receipt_id??'')){
    await threadStore.record({campaign_id,sequence:pending.sequence,ambiguous:true});return {status:'HALTED_AMBIGUOUS',sequence:pending.sequence};
   }
   await threadStore.record({campaign_id,sequence:pending.sequence,receipt_id:receipt.receipt_id,provider_receipt:receipt});sent++;
  }
  return {status:'PARTIAL',sent};
 };
}
module.exports={createV3ThreadPublication};
