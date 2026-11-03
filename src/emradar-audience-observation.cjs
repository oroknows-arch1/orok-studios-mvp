'use strict';
// Read-only measurement. A durable six-hour claim bounds API usage; failed
// reads never become zero engagement. No action or research conclusions change.
function createAudienceObservation({store,x,enabled=false,clock=()=>Date.now()}={}){
 if(!store?.adapter?.compareAndSwap||!store?.mutate||typeof x?.readThreadMetrics!=='function')throw Error('AUDIENCE_METRICS_DEPENDENCIES_REQUIRED');
 return async campaign_id=>{
  if(!enabled)return {status:'DISABLED'};
  const state=(await store.adapter.read(campaign_id))?.value,publication=state?.audience_x_publication;
  if(publication?.status!=='COMPLETE'||publication.manifest_sha256!==state.audience_x_review?.manifest_sha256)throw Error('AUDIENCE_CONFIRMED_THREAD_REQUIRED');
  const key='audience-metrics:'+campaign_id+':'+Math.floor(clock()/(6*60*60*1000));
  if(!await store.adapter.compareAndSwap(key,null,{status:'RUNNING',campaign_id,started_at:clock()}))return {status:'ALREADY_CLAIMED'};
  try{
   const observation=await x.readThreadMetrics({post_ids:publication.posts.map(p=>p.post_id)});
   const prior=await store.adapter.read(key);
   const result={status:'OBSERVED',...observation,source_manifest_sha256:publication.manifest_sha256,referrals:null,referral_status:'ANALYTICS_NOT_CONNECTED',public_actions:0};
   if(!await store.adapter.compareAndSwap(key,prior.version,result))throw Error('AUDIENCE_METRIC_CLAIM_CHANGED');
   await store.mutate(campaign_id,current=>{current.audience_x_observation={record_key:key,...result};return current;});return result;
  }catch(error){const prior=await store.adapter.read(key);if(prior.value.status==='RUNNING')await store.adapter.compareAndSwap(key,prior.version,{status:'FAILED',campaign_id,reason:/^[A-Z0-9_]+$/.test(error.message)?error.message:'AUDIENCE_METRICS_UNAVAILABLE'});return {status:'FAILED'};}
 };
}
module.exports={createAudienceObservation};
