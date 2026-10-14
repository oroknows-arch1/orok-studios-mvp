export function validateNotificationReceipt(receipt,recipient,campaignId) {
 if(recipient!=='oroknows@gmail.com') throw Error('INVALID_OWNER_RECIPIENT');
 if(!receipt?.accepted || !receipt.provider_id || receipt.recipient!==recipient || receipt.campaign_id!==campaignId) throw Error('NOTIFICATION_RECEIPT_UNVERIFIED');
 return {accepted:true,provider_id:receipt.provider_id,recipient,campaign_id:campaignId};
}
export function makeOwnerNotifier(transport) {
 if(typeof transport!=='function') throw Error('OWNER_TRANSPORT_REQUIRED');
 return async ({recipient,campaignId,link})=>{
  if(recipient!=='oroknows@gmail.com'||!campaignId) throw Error('INVALID_OWNER_NOTIFICATION');
  const url=new URL(link);
  if(url.protocol!=='https:' || !url.hash.startsWith('#token=')) throw Error('INVALID_PRIVATE_LINK');
  const receipt=await transport({to:recipient,subject:'EMRADAR publication review '+campaignId,text:link,campaignId});
  return validateNotificationReceipt(receipt,recipient,campaignId);
 };
}
