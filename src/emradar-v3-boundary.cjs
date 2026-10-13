'use strict';
// Pure CommonJS V3 contract checks for the paid API. Inert until mounted.
// Caller-provided approval is not proof: a trusted durable-state verifier
// must independently validate the saved asset, decision and claimed delivery.
function createV3Boundary({verifyNotification,verifyApprovedDelivery,sendOwnerReview,sendApprovedEmail,notificationReservation,sendReservation}={}){
 if([verifyNotification,verifyApprovedDelivery,sendOwnerReview,sendApprovedEmail].some(x=>typeof x!=='function'))throw Error('V3_TRUSTED_DEPENDENCIES_REQUIRED');
 if([notificationReservation,sendReservation].some(x=>typeof x?.reserve!=='function'||typeof x?.record!=='function'))throw Error('V3_DURABLE_RESERVATIONS_REQUIRED');
 return async ({operation,payload})=>{
  if(payload?.version!=='EMRADAR_V3')throw Error('V3_VERSION_REQUIRED');
  if(operation==='owner-notification'){
   if(payload.kind!=='OWNER_REVIEW'||payload.to!=='oroknows@gmail.com'||typeof payload.campaign_id!=='string'||typeof payload.private_review_url!=='string')throw Error('V3_NOTIFICATION_INVALID');
   const link=new URL(payload.private_review_url);
   if(link.protocol!=='https:'||!link.hash.startsWith('#token='))throw Error('V3_PRIVATE_LINK_REQUIRED');
   await verifyNotification(payload);
   const crypto=require('node:crypto');
   await notificationReservation.reserve({campaign_id:payload.campaign_id,link_sha256:crypto.createHash('sha256').update(payload.private_review_url).digest('hex')});
   let result;
   try{result=await sendOwnerReview(payload);}
   catch(error){await notificationReservation.record({campaign_id:payload.campaign_id});throw error;}
   await notificationReservation.record({campaign_id:payload.campaign_id,provider_id:result?.accepted===true?result?.provider_id:undefined});
   if(result?.accepted!==true||!result.provider_id)throw Error('V3_OWNER_SMTP_OUTCOME_UNCONFIRMED');
   return {accepted:true,provider_id:result.provider_id,recipient:payload.to,campaign_id:payload.campaign_id};
  }
  if(operation==='approved-delivery'){
   if(payload.kind!=='APPROVED_DELIVERY'||payload.asset?.kind!=='EMAIL'||typeof payload.idempotency_key!=='string'||!/^[a-f0-9]{64}$/.test(payload.idempotency_key))throw Error('V3_DELIVERY_INVALID');
   await verifyApprovedDelivery(payload);
   await sendReservation.reserve({idempotency_key:payload.idempotency_key,campaign_id:payload.campaign_id,destination_id:payload.destination_id,asset_sha256:payload.approval?.asset_sha256});
   let result;
   try{result=await sendApprovedEmail(payload);}
   catch(error){await sendReservation.record({idempotency_key:payload.idempotency_key});throw error;}
   await sendReservation.record({idempotency_key:payload.idempotency_key,provider_id:result?.accepted===true?result?.receipt_id:undefined});
   if(result?.accepted!==true||!result.receipt_id)throw Error('V3_SMTP_OUTCOME_UNCONFIRMED');
   return {accepted:true,receipt_id:result.receipt_id};
  }
  throw Error('V3_UNKNOWN_OPERATION');
 };
}
module.exports={createV3Boundary};
