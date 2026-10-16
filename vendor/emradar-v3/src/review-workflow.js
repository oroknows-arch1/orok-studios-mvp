import recipientPolicy from '../../../src/emradar-v3-recipient.cjs';
import {randomUUID} from 'node:crypto';
import {issueReviewAccess,consumeReviewAccess} from './review-access.js';
import {createOwnerSession,validateOwnerSession} from './owner-sessions.js';
import {identicalEmailGroupKey} from './contracts.js';
import {validateNotificationReceipt} from './owner-notification.js';

export class ReviewWorkflow {
 constructor({store,adapter,notify,baseUrl,clock=()=>Date.now()}) {
  if(!store?.adapter || !adapter?.read || !adapter?.compareAndSwap || typeof notify!=='function') throw Error('REVIEW_DEPENDENCIES_REQUIRED');
  const url=new URL(baseUrl);
  if(url.protocol!=='https:' || url.username || url.password || url.search || url.hash) throw Error('SECURE_REVIEW_URL_REQUIRED');
  this.store=store;this.adapter=adapter;this.notify=notify;this.baseUrl=url.origin;this.clock=clock;
 }
 async update(key,fn) {
  for(let attempt=0;attempt<8;attempt++){
   const prior=await this.adapter.read(key);
   const next=fn(structuredClone(prior?.value??null));
   if(await this.adapter.compareAndSwap(key,prior?.version??null,next)) return next;
  }
  throw Error('REVIEW_CONCURRENT_UPDATE');
 }
 async issue(campaignId) {
  const campaign=(await this.store.adapter.read(campaignId))?.value;
  if(!campaign || campaign.phase!=='PUBLICATION_REVIEW') throw Error('CAMPAIGN_NOT_READY');
  const key='review:'+campaignId;
  const now=this.clock();
  const existing=(await this.adapter.read(key))?.value;
  if(existing && !['EXPIRED','CONSUMED'].includes(existing.status) && existing.expires_at>now) throw Error('REVIEW_LINK_ALREADY_ISSUED');
  const {token,record}=issueReviewAccess({campaignId,now});
  await this.update(key,old=>{
   if(old && !['EXPIRED','CONSUMED'].includes(old.status) && old.expires_at>now) throw Error('REVIEW_LINK_ALREADY_ISSUED');
   return {...record,status:'ISSUED',owner_session:null,notification_id:randomUUID(),previous_reviews:old?[...(old.previous_reviews??[]),Object.fromEntries(Object.entries(old).filter(([key])=>key!=='previous_reviews'))]:[]};
  });
  const link=this.baseUrl+'/review/access#token='+encodeURIComponent(token)+'&campaign='+encodeURIComponent(campaignId);
  // Notification failure is recorded as AMBIGUOUS; never silently reissue a second live link.
  try {
   const receipt=await this.notify({recipient:'sean@emradar.net',campaignId,link});
   await this.update(key,current=>({...current,status:'NOTIFIED',notification_receipt:validateNotificationReceipt(receipt,'sean@emradar.net',campaignId)}));
  } catch(error) {
   await this.update(key,current=>({...current,status:'NOTIFICATION_AMBIGUOUS',notification_error_code:'TRANSPORT_OUTCOME_UNKNOWN'}));
   throw Error('REVIEW_NOTIFICATION_AMBIGUOUS');
  }
  return {campaignId,status:'NOTIFIED'}; // Never return the secret URL in logs/results.
 }
 async exchange(campaignId,token) {
  const key='review:'+campaignId;
  const now=this.clock();
  // Token consumption and session creation commit in one durable CAS write.
  const {secret,record}=createOwnerSession(campaignId,{now});
  const sessionId=randomUUID();
  await this.update(key,current=>{
   if(!current || current.campaign_id!==campaignId) throw Error('REVIEW_ACCESS_DENIED');
   const consumed=consumeReviewAccess(current,token,{now});
   return {...consumed,status:'CONSUMED',owner_session:{id:sessionId,...record}};
  });
  return {sessionId,secret,expiresAt:record.expires_at};
 }
 async authenticate(campaignId,sessionId,secret) {
  const review=(await this.adapter.read('review:'+campaignId))?.value;
  const current=review?.owner_session;
  if(!current || current.id!==sessionId) throw Error('OWNER_SESSION_REQUIRED');
  return validateOwnerSession(current,secret,campaignId,{now:this.clock()});
 }
 async view(campaignId,sessionId,secret) {
  await this.authenticate(campaignId,sessionId,secret);
  const campaign=(await this.store.adapter.read(campaignId))?.value;
  if(!campaign || campaign.phase!=='PUBLICATION_REVIEW') throw Error('REVIEW_NOT_OPEN');
  return {campaignId,scan:campaign.scan,entries:Object.values(campaign.assets).filter(({asset})=>asset.kind==='X'||(()=>{try{recipientPolicy.assertVerifiedAsset(asset,campaign.destinations.find(d=>d.id===asset.destination_id));return true;}catch{return false;}})()).map(({asset,fingerprint})=>({
   asset,fingerprint,groupKey:asset.kind==='EMAIL'?identicalEmailGroupKey(asset):null,decision:campaign.decisions[asset.destination_id]??null,
   delivery:campaign.deliveries[asset.destination_id]??null
  }))};
 }
 async decide(campaignId,sessionId,secret,destinationId,decision,fingerprint) {
  await this.authenticate(campaignId,sessionId,secret);
  return this.store.decide(campaignId,destinationId,decision,fingerprint);
 }
 async revise(campaignId,sessionId,secret,destinationId,fingerprint,changes) {
  await this.authenticate(campaignId,sessionId,secret);
  return this.store.revise(campaignId,destinationId,fingerprint,changes);
 }
 async decideGroup(campaignId,sessionId,secret,groupKey,decision) {
  await this.authenticate(campaignId,sessionId,secret);
  if(!['APPROVE','REJECT'].includes(decision)) throw Error('INVALID_DECISION');
  if(typeof groupKey!=='string' || !groupKey) throw Error('INVALID_GROUP_KEY');
  return this.store.mutate(campaignId,state=>{
   if(!state || state.phase!=='PUBLICATION_REVIEW') throw Error('REVIEW_NOT_OPEN');
   let count=0;
   for(const {asset,fingerprint} of Object.values(state.assets)){
    if(asset.kind!=='EMAIL' || identicalEmailGroupKey(asset)!==groupKey) continue;
    recipientPolicy.assertVerifiedAsset(asset,state.destinations.find(d=>d.id===asset.destination_id));
    if(state.deliveries[asset.destination_id]) throw Error('DECISION_AFTER_DISTRIBUTION');
    // Existing individual decisions are authoritative.
    if(state.decisions[asset.destination_id]) continue;
    state.decisions[asset.destination_id]={authority:'OWNER',decision,asset_sha256:fingerprint,campaign_id:campaignId,destination_id:asset.destination_id};
    count++;
   }
   if(!count) throw Error('NO_UNDECIDED_GROUP_ITEMS');
   return state;
  });
 }
}
