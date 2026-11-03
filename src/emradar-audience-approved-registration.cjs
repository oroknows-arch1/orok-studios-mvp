'use strict';
const {assetHash}=require('./emradar-audience-asset-hash.cjs');
function createApprovedThreadRegistration({store,verifyApprovedThread}={}){
 if(typeof store?.register!=='function'||typeof verifyApprovedThread!=='function')throw Error('APPROVED_REGISTRATION_DEPENDENCIES_REQUIRED');
 return async function registerApprovedThread({campaign_id,approved_thread}={}){
  if(typeof campaign_id!=='string'||!campaign_id||!Array.isArray(approved_thread?.segments)||approved_thread.segments.length<2)throw Error('APPROVED_REGISTRATION_INPUT_INVALID');
  const approved_segments=approved_thread.segments.map((segment,i)=>{
   if(segment?.sequence!==i+1||segment.approval_status!=='APPROVED')throw Error('APPROVED_REGISTRATION_SEGMENT_INVALID');
   const asset_sha256=assetHash(segment);
   if(segment.asset_sha256!==asset_sha256)throw Error('APPROVED_REGISTRATION_HASH_MISMATCH');
   return {...segment,asset_sha256};
  });
  const verified=await verifyApprovedThread({campaign_id,approved_thread});
  if(verified!==true)throw Error('APPROVED_REGISTRATION_NOT_VERIFIED');
  await store.register({campaign_id,approved_segments});
  return {status:'REGISTERED',campaign_id,segment_count:approved_segments.length};
 };
}
module.exports={createApprovedThreadRegistration};
