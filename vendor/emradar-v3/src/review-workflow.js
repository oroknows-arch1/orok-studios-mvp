import {isReviewPhase} from './contracts.js';
import {proposalBinding} from './proposal-verification.js';
import recipientPolicy from '../../../src/emradar-v3-recipient.cjs';
import {randomUUID,createHash,timingSafeEqual} from 'node:crypto';
import {issueReviewAccess,consumeReviewAccess} from './review-access.js';
import {createOwnerSession,validateOwnerSession,OWNER_SESSION_TTL_MS} from './owner-sessions.js';
import {validateNotificationReceipt} from './owner-notification.js';

// An owner investigation is not an actionable publication review.
// It may expose a held, signed scan to its owner but cannot authorize release.
const isOwnerInvestigation=campaign=>campaign?.phase==='SCAN_VERIFIED'&&
 typeof campaign?.scan?.artifact_sha256==='string'&&/^[a-f0-9]{64}$/.test(campaign.scan.artifact_sha256)&&
 [campaign?.preparation_input?.document?.claim_audit,campaign?.claim_gate_previous?.document?.claim_audit]
  .some(audit=>Array.isArray(audit)&&audit.length>0);
const canOpenOwnerReview=campaign=>isReviewPhase(campaign?.phase)||isOwnerInvestigation(campaign);

export class ReviewWorkflow {
 constructor({store,adapter,notify,baseUrl,verifyRecipient,verifier=null,clock=()=>Date.now()}) {
  if(!store?.adapter || !adapter?.read || !adapter?.compareAndSwap || typeof notify!=='function') throw Error('REVIEW_DEPENDENCIES_REQUIRED');
  const url=new URL(baseUrl);
  if(url.protocol!=='https:' || url.username || url.password || url.search || url.hash) throw Error('SECURE_REVIEW_URL_REQUIRED');
  this.store=store;this.adapter=adapter;this.notify=notify;this.baseUrl=url.origin;this.verifyRecipient=verifyRecipient;this.verifier=verifier;this.clock=clock;
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
  if(!canOpenOwnerReview(campaign)) throw Error('CAMPAIGN_NOT_READY');
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
  if(!canOpenOwnerReview(campaign))throw Error('REVIEW_NOT_OPEN');
  const current=(await this.adapter.read('review:'+campaignId))?.value;
  const equalHash=(expected,secret)=>{if(typeof expected!=='string'||typeof secret!=='string')return false;const a=Buffer.from(expected,'hex'),b=createHash('sha256').update(secret).digest();return a.length===b.length&&timingSafeEqual(a,b);};
  const session=current?.owner_session;
  const tokenProof=equalHash(current?.token_hash,token);
  let sessionProof=false;
  if(session?.id===sessionId){try{validateOwnerSession(session,sessionSecret,campaignId,{now:this.clock()});sessionProof=true;}catch{}}
  // This proof permits an email to the fixed owner only; it never authenticates a view or release.
  if(!tokenProof&&!sessionProof)throw Error('REVIEW_ACCESS_DENIED');
  // A valid reusable session needs no replacement invitation. The normal view request renews it.
  if(sessionProof)return {status:'ACTIVE_SESSION'};
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
  const original=(await this.adapter.read(campaignId))?.value;
  if(!canOpenOwnerReview(original))throw Error('REVIEW_NOT_OPEN');
  const campaign=isOwnerInvestigation(original)?original:typeof this.store.ensureEmailGroups==='function'?await this.store.ensureEmailGroups(campaignId):original;
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
    delivery:historical?null:campaign.deliveries[asset.destination_id]??null,
    verification:historical?null:campaign.proposal_verifications?.[asset.destination_id]?.findLast(item=>item.asset_sha256===fingerprint)??null};
  };
  const history=[];
  for(const versions of Object.values(campaign.editorial_versions??{}))for(const entry of versions)if(entry?.asset)history.push(describe(entry,{historical:true,label:entry.hold_reason?'Held for claim evidence review':'Previous draft'}));
  for(const entry of campaign.editorial_rewrite?.rejected??[])if(entry?.asset)history.push(describe(entry,{historical:true,label:'Rejected draft',decision:entry.rejection??entry.previous_decision??null}));
  for(const entry of campaign.editorial_rewrite?.variants??[])if(entry?.asset)history.push(describe(entry,{historical:true,label:'Saved writing alternative'}));
  const described=Object.values(campaign.assets??{}).map(entry=>describe(entry));
  const actionable=described.filter(entry=>entry.asset.review_status!=='NEEDS_REVISION'&&entry.recipient_ready!==false);
  const actionableIds=new Set(actionable.map(entry=>entry.asset.destination_id));
  const groups=Object.values(campaign.email_groups??{}).map(group=>({...group,destination_ids:group.destination_ids.filter(id=>actionableIds.has(id)),approval:campaign.group_approvals?.[group.id]??null})).filter(group=>group.destination_ids.length);
  // Owner-only, read-only visibility into the original scan investigation. Held
  // candidates are NOT publication assets and never receive an approval control.
  // Historical retry audits are preserved so a one-record recovery does not
  // erase the seven other discoveries from the owner's view.
  const audits=[...(campaign.claim_gate_history??[]).map(item=>item?.document?.claim_audit),campaign.claim_gate_previous?.document?.claim_audit,campaign.preparation_input?.document?.claim_audit].filter(Array.isArray);
  const investigationById=new Map();
  for(const audit of audits)for(const item of audit){
   if(typeof item?.record_id!=='string'||!item.record_id)continue;
   investigationById.set(item.record_id,{
    id:item.record_id,status:item.status??'UNRESOLVED',
    supported_claims:(item.claims??[]).filter(claim=>claim.status==='SUPPORTED'||claim.status==='PARTIAL_SUPPORTED').length,
    unresolved_claims:(item.claims??[]).filter(claim=>claim.status!=='SUPPORTED'&&claim.status!=='PARTIAL_SUPPORTED').length
   });
  }
  const admitted=new Set(campaign.preparation_input?.document?.records?.map(record=>record.id)??[]);
  const scanRecords=Array.isArray(campaign.owner_investigation_records)?campaign.owner_investigation_records:[];
  for(const source of scanRecords){
   if(typeof source?.id!=='string'||!source.id||investigationById.has(source.id))continue;
   investigationById.set(source.id,{id:source.id,status:'NOT_CHECKED',supported_claims:0,unresolved_claims:0});
  }
  const sourceById=new Map(scanRecords.map(item=>[item.id,item]));
  const investigation=[...investigationById.values()].map(item=>({
   ...item,owner_triage:campaign.owner_investigation_triage?.[item.id]??null,
   admitted:admitted.has(item.id),
   scanner_theme:sourceById.get(item.id)?.theme??'',
   scanner_rationale:sourceById.get(item.id)?.why_surfaced??'',
   scanner_status:sourceById.get(item.id)?.scanner_status??'UNKNOWN'
  }));
  return {campaignId,phase:campaign.phase,investigation_only:isOwnerInvestigation(campaign),completion:campaign.review_completion??null,automaticVerification:campaign.automatic_proposal_verification??null,warnings:campaign.preparation_warnings??[],scan:campaign.scan,entries:actionable,internal_incomplete_count:described.length-actionable.length,history,groups,investigation};
 }
 async triageInvestigation(campaignId,sessionId,secret,recordId,decision,note='') {
  await this.authenticate(campaignId,sessionId,secret);
  if(typeof recordId!=='string'||!recordId||recordId.length>180||
     !['PRIORITIZE','DEFER','EXCLUDE'].includes(decision)||typeof note!=='string'||note.length>1500)
   throw Error('INVALID_INVESTIGATION_TRIAGE');
  const state=(await this.adapter.read(campaignId))?.value;
  if(!canOpenOwnerReview(state))throw Error('REVIEW_NOT_OPEN');
  const candidates=new Set((state.owner_investigation_records??[]).map(item=>item.id));
  if(!candidates.has(recordId))throw Error('UNKNOWN_INVESTIGATION_RECORD');
  // Owner triage selects research priority, NEVER overrides verified evidence,
  // creates a publication asset, or grants X/email release permission.
  await this.store.mutate(campaignId,current=>{
   if(!canOpenOwnerReview(current)||(current.owner_investigation_records??[]).every(item=>item.id!==recordId))
    throw Error('STALE_INVESTIGATION_RECORD');
   const prior=current.owner_investigation_triage?.[recordId];
   current.owner_investigation_triage??={};
   const timestamp=new Date(this.clock()).toISOString();
   current.owner_investigation_triage[recordId]={decision,note,updated_at:timestamp};
   current.events??=[];
   current.events.push({type:'OWNER_INVESTIGATION_TRIAGED',record_id:recordId,decision,updated_at:timestamp,previous_decision:prior?.decision??null});
   return current;
  });
  return {saved:true,record_id:recordId,decision};
 }
 async decide(campaignId,sessionId,secret,destinationId,decision,fingerprint,feedback='') {
  await this.authenticate(campaignId,sessionId,secret);
  if(decision==='APPROVE'){
   const campaign=(await this.store.adapter.read(campaignId))?.value,entry=campaign?.assets?.[destinationId];
   const destination=campaign?.destinations?.find(item=>item.id===destinationId);
   if(entry?.asset?.review_status==='NEEDS_REVISION'||!entry||!recipientPolicy.recipientReadyForReview(entry.asset,destination))throw Error('V3_ACTIONABLE_REVIEW_REQUIRED');
  }
  return this.store.decide(campaignId,destinationId,decision,fingerprint,feedback);
 }
 async verifyAgain(campaignId,sessionId,secret,destinationId,fingerprint){
  await this.authenticate(campaignId,sessionId,secret);if(!this.verifier)throw Error('PROPOSAL_VERIFICATION_UNAVAILABLE');
  const campaign=(await this.store.adapter.read(campaignId))?.value,entry=campaign?.assets?.[destinationId];if(!entry||entry.fingerprint!==fingerprint)throw Error('STALE_ASSET_VERIFICATION');
  const destination=campaign.destinations.find(item=>item.id===destinationId);
  const evidence=campaign.preparation_input?.document?.evidence??[];
  const binding=proposalBinding({asset:entry.asset,destination,evidence});
  const current=campaign.proposal_verifications?.[destinationId]?.at(-1)??null;
  const valid=record=>record?.status==='VERIFIED'&&record.deliverable===true&&Array.isArray(record.claims)&&record.claims.length>0&&record.claims.every(claim=>claim.material===false||claim.status==='VERIFIED')&&typeof record.expires_at==='string'&&Date.parse(record.expires_at)>this.clock()&&record.evidence_sha256===binding.evidence_sha256;
  // A repeat click for unchanged content must not trigger another paid investigation.
  if(valid(current)&&Object.keys(binding).every(key=>current[key]===binding[key]))return {...current,reused:true,reuse_reason:current.review_scope==='SHARED_EXACT_CONTENT'?'IDENTICAL_CONTENT_AND_EVIDENCE':'UNCHANGED_PROPOSAL'};
  // Share only verified findings for the exact same complete subject and body, evidence,
  // kind and evidence IDs. Recipient-specific changes never share a verification.
  const sameContent=other=>other.asset.kind===entry.asset.kind&&other.asset.subject===entry.asset.subject&&other.asset.body===entry.asset.body&&JSON.stringify([...(other.asset.evidence_ids??[])].sort())===JSON.stringify([...(entry.asset.evidence_ids??[])].sort());
  for(const [otherId,other] of Object.entries(campaign.assets??{})){
   if(otherId===destinationId||!sameContent(other))continue;
   const source=(campaign.proposal_verifications?.[otherId]??[]).findLast(valid);
   if(!source||source.asset_sha256!==other.fingerprint)continue;
   const sourceDestination=campaign.destinations.find(item=>item.id===otherId);
   const sourceBinding=proposalBinding({asset:other.asset,destination:sourceDestination,evidence});
   if(Object.keys(sourceBinding).some(key=>source[key]!==sourceBinding[key]))continue;
   const verification={...structuredClone(source),...binding,id:randomUUID(),reused_from_verification_id:source.id,review_scope:'SHARED_EXACT_CONTENT',verified_at:source.verified_at,expires_at:source.expires_at};
   await this.store.recordProposalVerification(campaignId,destinationId,fingerprint,verification);
   return {...verification,reused:true,reuse_reason:'IDENTICAL_CONTENT_AND_EVIDENCE'};
  }
  const verification=await this.verifier.verify({asset:entry.asset,destination,evidence,previous:current});
  await this.store.recordProposalVerification(campaignId,destinationId,fingerprint,verification);
  // Automatically populate identical proposals after one successful investigation.
  // This does not approve recipients, edit their drafts, or make outbound sends.
  if(valid(verification)){
   for(const [otherId,other] of Object.entries(campaign.assets??{})){
    if(otherId===destinationId||!sameContent(other))continue;
    const dest=campaign.destinations.find(item=>item.id===otherId);
    const otherBinding=proposalBinding({asset:other.asset,destination:dest,evidence});
    const last=campaign.proposal_verifications?.[otherId]?.at(-1);
    if(last&&Object.keys(otherBinding).every(key=>last[key]===otherBinding[key])&&valid(last))continue;
    const shared={...structuredClone(verification),...otherBinding,id:randomUUID(),reused_from_verification_id:verification.id,review_scope:'SHARED_EXACT_CONTENT'};
    await this.store.recordProposalVerification(campaignId,otherId,other.fingerprint,shared);
   }
  }
  return {...verification,reused:false};
 }
 async revise(campaignId,sessionId,secret,destinationId,fingerprint,changes) {
  await this.authenticate(campaignId,sessionId,secret);
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
