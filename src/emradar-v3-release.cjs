'use strict';
// One owner-authenticated release path, shared by EMAIL and X.
function createV3Release({service,integration,pool}){
 return async({campaignId,destinationId,sessionId,sessionSecret}={})=>{
  if([campaignId,destinationId,sessionId,sessionSecret].some(v=>typeof v!=='string'||!v))throw Error('V3_RELEASE_REQUEST_INVALID');
  await service.workflow.authenticate(campaignId,sessionId,sessionSecret);
  const state=(await service.store.adapter.read(campaignId))?.value;
  const entry=state?.assets?.[destinationId],approval=state?.decisions?.[destinationId];
  if(state?.phase!=='PUBLICATION_REVIEW'||!['EMAIL','X'].includes(entry?.asset?.kind)||approval?.authority!=='OWNER'||approval?.decision!=='APPROVE'||approval.asset_sha256!==entry.fingerprint||state.deliveries?.[destinationId])throw Error('V3_RELEASE_NOT_APPROVED');
  const payload={version:'EMRADAR_V3',kind:'APPROVED_DELIVERY',campaign_id:campaignId,destination_id:destinationId,asset:entry.asset,approval};
  // Disabled configuration, unknown publication history and invalid graphics
  // fail BEFORE a delivery claim. Preflight never uploads or posts anything.
  let preparedX;
  if(entry.asset.kind==='X')preparedX=await integration.prepareApprovedX(payload);
  else await require('./emradar-v3-recipient.cjs').checkPersistedRecipient(pool,entry.asset,state);
  const claimed=await service.store.claimDelivery(campaignId,destinationId);
  payload.idempotency_key=claimed.deliveries[destinationId].idempotency_key;
  let receipt;
  try{
   receipt=await integration.handle({operation:'approved-delivery',payload,preparedX});
  }catch{
   await service.store.recordDelivery(campaignId,destinationId,'AMBIGUOUS',{reason:'TRANSPORT_OUTCOME_UNKNOWN'});
   throw Error('V3_DELIVERY_OUTCOME_AMBIGUOUS');
  }
  // If campaign persistence fails after provider acceptance, the independent
  // reservation still contains the provider ID and prevents another attempt.
  await service.store.recordDelivery(campaignId,destinationId,'ACCEPTED',{...receipt,provider_id:receipt.receipt_id});
  return {...receipt,status:'ACCEPTED',campaignId,destinationId};
 };
}
module.exports={createV3Release};
