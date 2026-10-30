import {isReviewPhase} from './contracts.js';
import recipientPolicy from '../../../src/emradar-v3-recipient.cjs';
import {randomUUID,createHash,timingSafeEqual} from 'node:crypto';
import {issueReviewAccess,consumeReviewAccess} from './review-access.js';
import {createOwnerSession,validateOwnerSession,OWNER_SESSION_TTL_MS} from './owner-sessions.js';
import {validateNotificationReceipt} from './owner-notification.js';

export class ReviewWorkflow {
 constructor({store,adapter,notify,baseUrl,verifyRecipient,clock=()=>Date.now()}) {
  if(!store?.adapter || !adapter?.read || !adapter?.compareAndSwap || typeof notify!=='function') throw Error('REVIEW_DEPENDENCIES_REQUIRED');
  const url=new URL(baseUrl);
  if(url.protocol!=='https:' || url.username || url.password || url.search || url.hash) throw Error('SECURE_REVIEW_URL_REQUIRED');
  this.store=store;this.adapter=adapter;this.notify=notify;this.baseUrl=url.origin;this.verifyRecipient=verifyRecipient;this.clock=clock;
 }
 async update(key,fn) {
  for(let attempt=0;attempt<8;attempt++){
   const prior=await this.adapter.read(key);
   const next=fn(structuredClone(prior?.value??null));
   if(await this.adapter.compareAndSwap(key,prior?.version??null,next)) return next;
  }
  throw Error('REVIEW_CONCURRENT_UPDATE');
 }
 async issue(campaignId,{revisionId=null}={}) {
  const campaign=(await this.store.adapter.read(campaignId))?.value;
  if(!campaign || !isReviewPhase(campaign.phase)) throw Error('CAMPAIGN_NOT_READY');
  const key='review:'+campaignId;
  const now=this.clock();
  const existing=(await this.adapter.read(key))?.value;
  if(revisionId&&existing?.revision_id===revisionId){
   if(['NOTIFIED','CONSUMED'].includes(existing.status))return {campaignId,status:'NOTIFIED',revisionId,existing:true};
   if(['ISSUED','NOTIFICATION_AMBIGUOUS'].includes(existing.status))throw Error('REVIEW_NOTIFICATION_AMBIGUOUS');
  }
  const replaceForRevision=Boolean(revisionId&&existing?.revision_id!==revisionId);
  if(existing && !replaceForRevision && !['EXPIRED','CONSUMED'].includes(existing.status) && existing.expires_at>now) throw Error('REVIEW_LINK_ALREADY_ISSUED');
  const {token,record}=issueReviewAccess({campaignId,now});
  await this.update(key,old=>{
   if(old?.revision_id===revisionId&&revisionId&&['NOTIFIED','CONSUMED'].includes(old.status))throw Error('REVIEW_REVISION_ALREADY_NOTIFIED');
   if(old && !replaceForRevision && !['EXPIRED','CONSUMED'].includes(old.status) && old.expires_at>now) throw Error('REVIEW_LINK_ALREADY_ISSUED');
   return {...record,status:'ISSUED',revision_id:revisionId,owner_session:null,notification_id:randomUUID(),previous_reviews:old?[...(old.previous_reviews??[]),Object.fromEntries(Object.entries(old).filter(([key])=>key!=='previous_reviews'))]:[]};
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
 async requestAccess(campaignId,{token,sessionId,sessionSecret}={}){
  const campaign=(await this.store.adapter.read(campaignId))?.value;
  if(!isReviewPhase(campaign?.phase))throw Error('REVIEW_NOT_OPEN');
  const current=(await this.adapter.read('review:'+campaignId))?.value;
  const equalHash=(expected,secret)=>{if(typeof expected!=='string'||typeof secret!=='string')return false;const a=Buffer.from(expected,'hex'),b=createHash('sha256').update(secret).digest();return a.length===b.length&&timingSafeEqual(a,b);};
  const session=current?.owner_session;
  const proof=equalHash(current?.token_hash,token)||(session?.id===sessionId&&session?.revoked_at===null&&equalHash(session?.secret_hash,sessionSecret));
  // This proof permits an email to the fixed owner only; it never authenticates a view or release.
  if(!proof)throw Error('REVIEW_ACCESS_DENIED');
  if(current&&!['CONSUMED','EXPIRED'].includes(current.status)&&current.expires_at>this.clock())return {status:'EXISTING_INVITATION'};
  // Fixed owner recipient; one durable request per campaign/day, never automatic resend.
  const key='review-access-request:'+campaignId+':'+new Date(this.clock()).toISOString().slice(0,10);
  if(!await this.adapter.compareAndSwap(key,null,{status:'REQUESTED',requested_at:this.clock()}))throw Error('REVIEW_ACCESS_REQUEST_ALREADY_RECORDED');
  try{await this.issue(campaignId);await this.update(key,old=>({...old,status:'SMTP_ACCEPTED'}));return {status:'SMTP_ACCEPTED'};}
  catch(error){await this.update(key,old=>({...old,status:'OUTCOME_UNCONFIRMED'}));throw error;}
 }
 async renewSession(campaignId,sessionId,secret){
  // Only an unexpired, unrevoked session can extend itself. Old consumed tokens never qualify.
  await this.authenticate(campaignId,sessionId,secret);
  const now=this.clock();
  await this.update('review:'+campaignId,current=>{
   if(current.owner_session?.id!==sessionId)throw Error('OWNER_SESSION_REQUIRED');
   validateOwnerSession(current.owner_session,secret,campaignId,{now});
   current.owner_session.expires_at=now+OWNER_SESSION_TTL_MS;return current;
  });
  return now+OWNER_SESSION_TTL_MS;
 }
 async view(campaignId,sessionId,secret) {
  await this.authenticate(campaignId,sessionId,secret);
  const campaign=typeof this.store.ensureEmailGroups==='function'?await this.store.ensureEmailGroups(campaignId):(await this.adapter.read(campaignId))?.value;
  if(!campaign || !isReviewPhase(campaign.phase)) throw Error('REVIEW_NOT_OPEN');
  const memberGroups=new Map(Object.values(campaign.email_groups??{}).flatMap(group=>group.destination_ids.map(destinationId=>[destinationId,group.id])));
  const describe=(entry,{historical=false,label='',decision=null}={})=>{
   const {asset,fingerprint}=entry;
   const destination=campaign.destinations.find(d=>d.id===asset.destination_id);
   const recipientReady=asset.kind!=='EMAIL'||recipientPolicy.recipientReadyForReview(asset,destination);
   const revision=!historical?(campaign.events??[]).findLast(event=>event.type==='ASSET_REVISED'&&event.destination_id===asset.destination_id&&event.new_fingerprint===fingerprint):null;
   return {asset,fingerprint,historical,label,destination:{id:asset.destination_id,name:destination?.name||asset.destination_id},recipient_ready:recipientReady,
    revision:revision?{id:revision.id,fingerprint}:null,
    recipient_warning:asset.recipient_verification?.status==='OWNER_OVERRIDE'?asset.recipient_verification.warning_code:null,
    groupId:!historical?memberGroups.get(asset.destination_id)??null:null,recipientVerified:destination?.contact_verified===true,
    review_action:historical?null:campaign.review_actions?.[asset.destination_id]??null,
    rejection_feedback:historical?null:(campaign.review_feedback??[]).filter(item=>item.destination_id===asset.destination_id),
    decision:historical?decision:campaign.decisions[asset.destination_id]??null,
    delivery:historical?null:campaign.deliveries[asset.destination_id]??null};
  };
  const history=[];
  for(const versions of Object.values(campaign.editorial_versions??{}))for(const entry of versions)if(entry?.asset)history.push(describe(entry,{historical:true,label:'Previous draft'}));
  for(const entry of campaign.editorial_rewrite?.rejected??[])if(entry?.asset)history.push(describe(entry,{historical:true,label:'Rejected draft',decision:entry.rejection??entry.previous_decision??null}));
  for(const entry of campaign.editorial_rewrite?.variants??[])if(entry?.asset)history.push(describe(entry,{historical:true,label:'Saved writing alternative'}));
  const xThread=this.audienceThread?await this.audienceThread.view(campaignId):null;
  return {campaignId,phase:campaign.phase,completion:campaign.review_completion??null,warnings:campaign.preparation_warnings??[],scan:campaign.scan,xThread,entries:Object.values(campaign.assets).map(entry=>describe(entry)),history,groups:Object.values(campaign.email_groups??{}).map(group=>({...group,approval:campaign.group_approvals?.[group.id]??null}))};
 }
 async decide(campaignId,sessionId,secret,destinationId,decision,fingerprint,feedback='') {
  await this.authenticate(campaignId,sessionId,secret);
  if(destinationId==='x'&&this.audienceThread)return this.audienceThread.decide(campaignId,sessionId,decision,fingerprint);
  return this.store.decide(campaignId,destinationId,decision,fingerprint,feedback);
 }
 async revise(campaignId,sessionId,secret,destinationId,fingerprint,changes) {
  await this.authenticate(campaignId,sessionId,secret);
  if(destinationId==='x'&&this.audienceThread){await this.audienceThread.revise(campaignId,fingerprint,changes);return {saved:true};}
  let verifiedDestination=null;
  let recipientCheck=null;
  if(Object.hasOwn(changes??{},'to')){
   try{
    if(typeof this.verifyRecipient!=='function')throw Error('CONTACT_VERIFICATION_UNAVAILABLE');
    verifiedDestination=await this.verifyRecipient({campaignId,destinationId,fingerprint,email:changes.to});
   }catch(error){
    const candidate=error?.message??'';
    recipientCheck={ownerOverride:true,warningCode:/^[A-Z0-9_]{1,80}$/.test(candidate)?candidate:'CONTACT_VERIFICATION_FAILED'};
   }
  }
  await this.store.revise(campaignId,destinationId,fingerprint,changes,verifiedDestination,recipientCheck);
  return {saved:true,recipient_warning:recipientCheck?.warningCode??null};
 }
 async reviseGroup(campaignId,sessionId,secret,groupId,contentHash,version,changes){
  await this.authenticate(campaignId,sessionId,secret);
  return this.store.reviseGroup(campaignId,groupId,contentHash,version,changes);
 }
 async decideGroup(campaignId,sessionId,secret,groupId,decision,contentHash,version){
  await this.authenticate(campaignId,sessionId,secret);return this.store.decideGroup(campaignId,groupId,decision,contentHash,version);
 }
 async removeFromGroup(campaignId,sessionId,secret,groupId,destinationId,contentHash,version,action){
  await this.authenticate(campaignId,sessionId,secret);return this.store.removeFromGroup(campaignId,groupId,destinationId,contentHash,version,action);
 }
}
