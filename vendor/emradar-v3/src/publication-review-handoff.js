// Complete preparation before issuing the owner's private review invitation.
// No distribution operation is reachable from this handoff.
export function createPublicationReviewHandoff({prepare,workflow}) {
 if(typeof prepare!=='function' || typeof workflow?.issue!=='function') throw Error('REVIEW_HANDOFF_DEPENDENCIES_REQUIRED');
 return async input=>{
  const prepared=await prepare(input);
  if(!prepared?.campaignId || !['PUBLICATION_REVIEW','ALREADY_PREPARED'].includes(prepared.status)) throw Error('PREPARATION_NOT_READY_FOR_REVIEW');
  const notified=await workflow.issue(prepared.campaignId);
  if(notified?.campaignId!==prepared.campaignId || notified?.status!=='NOTIFIED') throw Error('REVIEW_NOTIFICATION_NOT_CONFIRMED');
  return {campaignId:prepared.campaignId,status:'PUBLICATION_REVIEW',notification:'NOTIFIED'};
 };
}
