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
  if(r.mode!=='STANDALONE'||r.segments.length>8||r.segments.some(s=>s.kind!=='DISCOVERY'||s.parent_sequence!==null)||typeof threadStore.reserveOriginal!=='function'||typeof x.originalHistory!=='function')throw Error('AUDIENCE_STANDALONE_BOUNDARY_REQUIRED');
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
   const parent=null;
   // Identity/history preflight occurs before reserving; it never uploads/posts.
   const prepared=await x.prepareThreadPost({segment,scan:r.scan,parent_receipt_id:parent});
   let receipt;
   try{
    receipt=await threadStore.reserveOriginal({account_id:prepared.account_id,campaign_id,sequence:pending.sequence,segment,source_key:r.scan.source_key,loadHistory:input=>x.originalHistory(input),verifyApproval:()=>review.verify({campaign_id,approved_thread:r}),submit:async({beforePost})=>{
     const result=await prepared.publish({beforePost,onMediaUploaded:upload=>threadStore.saveUpload({campaign_id,sequence:pending.sequence,upload})});
     if(result?.accepted!==true||!/^\d+$/.test(result.receipt_id??''))throw Error('AUDIENCE_RECEIPT_REQUIRED');
     await threadStore.record({campaign_id,sequence:pending.sequence,receipt_id:result.receipt_id,provider_receipt:result});return result;
    }});
   }catch(error){
    if(error.message==='AUDIENCE_DAILY_ORIGINAL_LIMIT')return {status:'DAILY_LIMIT',sent};
    return {status:'HALTED_AMBIGUOUS',sequence:pending.sequence};
   }
   if(receipt?.accepted!==true||!/^\d+$/.test(receipt.receipt_id??'')){
    await threadStore.record({campaign_id,sequence:pending.sequence,ambiguous:true});return {status:'HALTED_AMBIGUOUS',sequence:pending.sequence};
   }
   sent++;
  }
  return {status:'PARTIAL',sent};
 };
}
module.exports={createV3ThreadPublication};
