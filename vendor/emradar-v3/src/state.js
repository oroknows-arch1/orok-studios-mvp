import {isReviewPhase} from './contracts.js';
import recipientPolicy from '../../../src/emradar-v3-recipient.cjs';
import emailBrand from '../../../src/email-brand.cjs';
import { randomUUID } from 'node:crypto';
import { assertScan, assertDestinations, assetFingerprint, assertApproval, assertSendable, identicalEmailGroupKey, sha256 } from './contracts.js';

const groupIdFor=(campaignId,destinationIds)=>'email-group-'+sha256([campaignId,[...destinationIds].sort()]).slice(0,24);
const destinationIsVerified=(state,destinationId)=>state.destinations.some(destination=>destination.id===destinationId&&destination.contact_verified===true&&destination.delivery_eligible!==false);
const groupContent=asset=>({subject:asset.subject,body:asset.body,content_hash:identicalEmailGroupKey(asset)});
const createEmailGroups=(campaignId,state)=>{
 const byContent=new Map();
 for(const {asset} of Object.values(state.assets??{})){
  if(asset.kind!=='EMAIL'||asset.review_status==='NEEDS_REVISION'||!destinationIsVerified(state,asset.destination_id))continue;
  const content=groupContent(asset);if(!byContent.has(content.content_hash))byContent.set(content.content_hash,{...content,destination_ids:[]});
  byContent.get(content.content_hash).destination_ids.push(asset.destination_id);
 }
 return Object.fromEntries([...byContent.values()].map(group=>{group.destination_ids.sort();const id=groupIdFor(campaignId,group.destination_ids);return [id,{id,...group,version:1}];}));
};

export class CampaignStore {
  constructor(adapter) {
    if (!adapter || typeof adapter.read !== 'function' || typeof adapter.compareAndSwap !== 'function') throw Error('DURABLE_ADAPTER_REQUIRED');
    this.adapter = adapter;
  }
  async mutate(id, fn) {
    for (let i = 0; i < 8; i++) {
      const prior = await this.adapter.read(id);
      const next = fn(structuredClone(prior?.value ?? null));
      if (next === undefined) throw Error('INVALID_MUTATION');
      const written = await this.adapter.compareAndSwap(id, prior?.version ?? null, next);
      if (written) return next;
    }
    throw Error('CONCURRENT_UPDATE_RETRY_EXHAUSTED');
  }
  async start(scan) {
    const verified = assertScan(scan);
    const id = 'v3-' + sha256(verified.source_key).slice(0,32);
    await this.mutate(id, previous => {
      if (previous) {
        if (previous.scan.source_key !== verified.source_key) throw Error('SCAN_IDENTITY_CONFLICT');
        return previous;
      }
      return {id, scan:verified, phase:'SCAN_VERIFIED', destinations:[], assets:{}, email_groups:{}, group_approvals:{}, decisions:{}, deliveries:{}, events:[{type:'SCAN_VERIFIED',id:randomUUID()}]};
    });
    return id;
  }
  async select(id, destinations) {
    assertDestinations(destinations);
    return this.mutate(id, state => {
      if (!state || !['SCAN_VERIFIED','DESTINATIONS_SELECTED'].includes(state.phase)) throw Error('INVALID_PHASE');
      if (state.phase === 'DESTINATIONS_SELECTED' && sha256(state.destinations) !== sha256(destinations)) throw Error('DESTINATIONS_ALREADY_LOCKED');
      state.destinations = structuredClone(destinations);
      state.phase = 'DESTINATIONS_SELECTED';
      return state;
    });
  }
  async prepare(id, assets, warnings=[]) {
    return this.mutate(id, state => {
      if (!state || !['DESTINATIONS_SELECTED','PUBLICATION_REVIEW'].includes(state.phase)) throw Error('INVALID_PHASE');
      const valid = new Set(state.destinations.map(d => d.id));
      const next = {};
      for (const asset of assets) {
        if (!valid.has(asset.destination_id) || asset.campaign_id !== id || next[asset.destination_id]) throw Error('INVALID_ASSET_DESTINATION');
        if(asset.review_status!=='NEEDS_REVISION'&&asset.kind==='EMAIL')recipientPolicy.assertVerifiedAsset(asset,state.destinations.find(d=>d.id===asset.destination_id));
        next[asset.destination_id] = {asset:structuredClone(asset), fingerprint:assetFingerprint(asset)};
      }
      if (Object.keys(next).length !== state.destinations.length) throw Error('MISSING_DESTINATION_ASSET');
      if (state.phase === 'PUBLICATION_REVIEW' && sha256(next) !== sha256(state.assets)) throw Error('REVIEW_ASSETS_LOCKED');
      state.assets = next;
      state.email_groups=createEmailGroups(id,state);state.group_approvals??={};
      state.phase = 'PUBLICATION_REVIEW';
      state.preparation_warnings=[...(state.preparation_warnings??[]),...structuredClone(warnings)];
      return state;
    });
  }
  async extendReview(id,destinations,assets) {
    assertDestinations(destinations);
    return this.mutate(id,state=>{
      if(!state || !isReviewPhase(state.phase)) throw Error('REVIEW_NOT_OPEN');
      const existing=new Set(state.destinations.map(destination=>destination.id));
      const additions=new Map(destinations.filter(destination=>!existing.has(destination.id)).map(destination=>[destination.id,destination]));
      if(assets.length!==additions.size) throw Error('MISSING_DESTINATION_ASSET');
      for(const asset of assets){
        if(!additions.has(asset.destination_id)||asset.campaign_id!==id||state.assets[asset.destination_id]) throw Error('INVALID_ASSET_DESTINATION');
        if(asset.review_status!=='NEEDS_REVISION'&&asset.kind==='EMAIL')recipientPolicy.assertVerifiedAsset(asset,additions.get(asset.destination_id));
        state.assets[asset.destination_id]={asset:structuredClone(asset),fingerprint:assetFingerprint(asset)};
      }
      state.destinations.push(...[...additions.values()].map(destination=>structuredClone(destination)));
      if(!Object.keys(state.group_approvals??{}).length)state.email_groups=createEmailGroups(id,state);
      state.events.push({type:'EDITORIAL_DRAFTS_ADDED',count:additions.size,id:randomUUID()});
      return state;
    });
  }
  async ensureEmailGroups(id){
   return this.mutate(id,state=>{if(!state||!isReviewPhase(state.phase))throw Error('REVIEW_NOT_OPEN');if(state.email_groups===undefined)state.email_groups=createEmailGroups(id,state);state.group_approvals??={};return state;});
  }
  async decide(id, destinationId, decision, fingerprint, feedback='') {
    if(typeof feedback!=='string'||feedback.length>4000)throw Error('INVALID_OWNER_FEEDBACK');
    const note=feedback.trim();
    return this.mutate(id, state => {
      if (!state || !isReviewPhase(state.phase)) throw Error('REVIEW_NOT_OPEN');
      const item = state.assets[destinationId];
      if (!item || item.fingerprint !== fingerprint || !['APPROVE','REJECT','EXCLUDE','REGENERATE'].includes(decision)) throw Error('INVALID_DECISION');
      // Editorial decisions are independent of delivery readiness. Recipient
      // verification remains mandatory in claimDelivery and transport checks.
      if (state.deliveries[destinationId]) throw Error('DECISION_AFTER_DISTRIBUTION');
      if(decision==='APPROVE'&&item.asset.review_status==='NEEDS_REVISION')throw Error('INCOMPLETE_ASSET_CANNOT_BE_APPROVED');
      state.review_actions??={};
      state.decisions??={};
      if(['REJECT','REGENERATE'].includes(decision)){
       const requestedAt=new Date().toISOString(),requestId=randomUUID();
       const feedbackRecord={id:requestId,campaign_id:id,destination_id:destinationId,asset_sha256:fingerprint,feedback:note||null,requested_at:requestedAt};
       state.review_feedback??=[];state.review_feedback.push(feedbackRecord);
       state.decisions[destinationId]={authority:'OWNER',decision:'REJECT',asset_sha256:fingerprint,campaign_id:id,destination_id:destinationId,feedback_id:requestId,feedback_required:!note};
       state.review_actions[destinationId]={action:'REGENERATE',status:note?'PENDING':'NEEDS_FEEDBACK',request_id:requestId,revision_id:'review-'+requestId,requested_at:requestedAt,asset_sha256:fingerprint,feedback:note||null};
      }else{
       state.decisions[destinationId] = {authority:'OWNER',decision,asset_sha256:fingerprint,campaign_id:id,destination_id:destinationId};
       if(['PENDING','RUNNING','OWNER_REVIEW_PENDING'].includes(state.review_actions[destinationId]?.status))state.review_actions[destinationId]={...state.review_actions[destinationId],status:'CANCELLED',cancelled_at:new Date().toISOString()};
      }
      state.events??=[];state.events.push({type:'OWNER_ASSET_DECISION',destination_id:destinationId,decision:state.decisions[destinationId].decision,asset_sha256:fingerprint,feedback_id:state.decisions[destinationId].feedback_id??null});
      return state;
    });
  }
  async revise(id,destinationId,fingerprint,changes,verifiedDestination=null,recipientCheck=null) {
    if (!changes || typeof changes!=='object' || Array.isArray(changes)) throw Error('INVALID_REVISION');
    const allowed=['subject','body','to'];
    if (!Object.keys(changes).length || Object.keys(changes).some(key=>!allowed.includes(key))) throw Error('INVALID_REVISION_FIELDS');
    for (const [key,value] of Object.entries(changes)) {
      if(key==='to'){
        if(!recipientPolicy.validRecipient(value))throw Error('V3_VALID_RECIPIENT_REQUIRED');
        if(verifiedDestination&&verifiedDestination.contact?.email?.toLowerCase()!==value.toLowerCase())throw Error('V3_VERIFIED_RECIPIENT_REQUIRED');
        if(!verifiedDestination&&recipientCheck?.ownerOverride!==true)throw Error('V3_VERIFIED_RECIPIENT_REQUIRED');
        continue;
      }
      if (typeof value!=='string' || !value.trim() || value.length>50000) throw Error('INVALID_REVISION_TEXT');
    }
    return this.mutate(id,state=>{
      if (!state || !isReviewPhase(state.phase)) throw Error('REVIEW_NOT_OPEN');
      const entry=state.assets[destinationId];
      if (!entry || entry.fingerprint!==fingerprint) throw Error('STALE_ASSET_REVISION');
      if(Object.values(state.email_groups??{}).some(group=>group.destination_ids.includes(destinationId)&&group.destination_ids.length>1))throw Error('GROUP_REVISION_REQUIRED');
      if (state.deliveries[destinationId]) throw Error('REVISION_AFTER_DISTRIBUTION');
      const destinationIndex=state.destinations.findIndex(item=>item.id===destinationId);
      if(Object.hasOwn(changes,'to')){
        if(entry.asset.kind!=='EMAIL'||destinationIndex<0)throw Error('V3_VERIFIED_RECIPIENT_REQUIRED');
        if(verifiedDestination){
          if(verifiedDestination.id!==destinationId)throw Error('V3_VERIFIED_RECIPIENT_REQUIRED');
          recipientPolicy.assertVerifiedDestination(verifiedDestination);
        }else if(state.destinations[destinationIndex].opted_out||state.destinations[destinationIndex].do_not_contact||state.destinations[destinationIndex].contact?.opted_out||state.destinations[destinationIndex].contact?.do_not_contact)throw Error('V3_RECIPIENT_OPTED_OUT');
      }
      const revised={...entry.asset,...changes};
      if(Object.hasOwn(changes,'to')){
        if(verifiedDestination){
          revised.contact_status='VERIFIED';revised.delivery_eligible=true;revised.recipient_verification=structuredClone(verifiedDestination.contact);
          delete revised.recipient_owner_override;
        }else{
          revised.contact_status='OWNER_OVERRIDE';revised.delivery_eligible=false;
          revised.recipient_owner_override=true;
          revised.recipient_verification={status:'OWNER_OVERRIDE',warning_code:recipientCheck.warningCode??'CONTACT_VERIFICATION_FAILED'};
        }
      }
      if(revised.brand_version)revised.html=emailBrand.render(revised.body);
      if (sha256(revised)===sha256(entry.asset)) return state;
      if(Object.hasOwn(changes,'to')&&verifiedDestination)recipientPolicy.assertVerifiedAsset(revised,verifiedDestination);
      const nextFingerprint=assetFingerprint(revised);
      const priorDecision=state.decisions[destinationId]?.decision??null;
      state.editorial_versions??={};state.editorial_versions[destinationId]??=[];
      state.editorial_versions[destinationId].push(structuredClone(entry));
      if(Object.hasOwn(changes,'to')){
        if(verifiedDestination)state.destinations[destinationIndex]=structuredClone(verifiedDestination);
        else{
          const destination=state.destinations[destinationIndex];
          state.destinations[destinationIndex]={...destination,contact:{email:changes.to,purpose:null,eligible:false,source_url:null,published_excerpt:null,page_sha256:null},contact_verified:false,delivery_eligible:false,contact_status:'OWNER_OVERRIDE',recipient_owner_override:true,recipient_verification_warning:recipientCheck.warningCode??'CONTACT_VERIFICATION_FAILED'};
        }
      }
      state.assets[destinationId]={asset:revised,fingerprint:nextFingerprint};
      delete state.decisions[destinationId];
      state.events.push({type:'ASSET_REVISED',destination_id:destinationId,id:randomUUID(),previous_fingerprint:fingerprint,new_fingerprint:nextFingerprint,previous_decision:priorDecision,changed_fields:Object.keys(changes)});
      return state;
    });
  }
  async reviseGroup(id,groupId,contentHash,version,changes){
   if(!changes||typeof changes!=='object'||Array.isArray(changes)||!Object.keys(changes).length||Object.keys(changes).some(key=>!['subject','body'].includes(key)))throw Error('INVALID_REVISION_FIELDS');
   for(const value of Object.values(changes))if(typeof value!=='string'||!value.trim()||value.length>50000)throw Error('INVALID_REVISION_TEXT');
   return this.mutate(id,state=>{
    if(!state||!isReviewPhase(state.phase))throw Error('REVIEW_NOT_OPEN');const group=state.email_groups?.[groupId];
    if(!group||group.content_hash!==contentHash||group.version!==version)throw Error('STALE_GROUP_VERSION');
    if(group.destination_ids.some(destinationId=>state.deliveries[destinationId]))throw Error('REVISION_AFTER_DISTRIBUTION');
    for(const destinationId of group.destination_ids){const entry=state.assets[destinationId];if(!entry||identicalEmailGroupKey(entry.asset)!==contentHash)throw Error('GROUP_CONTENT_MISMATCH');}
    const nextContent=groupContent({...state.assets[group.destination_ids[0]].asset,...changes});if(nextContent.content_hash===contentHash)return state;
    for(const destinationId of group.destination_ids){const entry=state.assets[destinationId],revised={...entry.asset,...changes};if(revised.brand_version)revised.html=emailBrand.render(revised.body);state.editorial_versions??={};state.editorial_versions[destinationId]??=[];state.editorial_versions[destinationId].push(structuredClone(entry));state.assets[destinationId]={asset:revised,fingerprint:assetFingerprint(revised)};delete state.decisions[destinationId];}
    const priorApproval=state.group_approvals?.[groupId]??null;delete state.group_approvals[groupId];Object.assign(group,nextContent,{version:group.version+1});
    state.events.push({type:'EMAIL_GROUP_REVISED',group_id:groupId,id:randomUUID(),previous_content_hash:contentHash,new_content_hash:nextContent.content_hash,previous_version:version,new_version:group.version,previous_approval:priorApproval,changed_fields:Object.keys(changes)});return state;
   });
  }
  async decideGroup(id,groupId,decision,contentHash,version){
   if(!['APPROVE','REJECT'].includes(decision))throw Error('INVALID_DECISION');
   return this.mutate(id,state=>{
    if(!state||!isReviewPhase(state.phase))throw Error('REVIEW_NOT_OPEN');const group=state.email_groups?.[groupId];
    if(!group||group.content_hash!==contentHash||group.version!==version)throw Error('STALE_GROUP_VERSION');const members=[...group.destination_ids];if(!members.length)throw Error('EMPTY_GROUP');
    for(const destinationId of members){const entry=state.assets[destinationId];if(!destinationIsVerified(state,destinationId))throw Error('UNVERIFIED_RECIPIENT');if(!entry||identicalEmailGroupKey(entry.asset)!==contentHash)throw Error('GROUP_CONTENT_MISMATCH');if(entry.asset.review_status==='NEEDS_REVISION'&&decision==='APPROVE')throw Error('INCOMPLETE_ASSET_CANNOT_BE_APPROVED');if(state.deliveries[destinationId])throw Error('DECISION_AFTER_DISTRIBUTION');if(state.decisions[destinationId]&&state.decisions[destinationId].decision!==decision)throw Error('GROUP_DECISION_CONFLICT');}
    const recipientSetHash=sha256(members),prior=state.group_approvals?.[groupId];if(prior?.decision===decision&&prior.content_hash===contentHash&&prior.recipient_set_sha256===recipientSetHash)return state;
    for(const destinationId of members){const fingerprint=state.assets[destinationId].fingerprint;state.decisions[destinationId]={authority:'OWNER',decision,asset_sha256:fingerprint,campaign_id:id,destination_id:destinationId,group_id:groupId,group_content_hash:contentHash};}
    state.group_approvals??={};state.group_approvals[groupId]={authority:'OWNER',decision,campaign_id:id,group_id:groupId,content_hash:contentHash,version:group.version,destination_ids:members,recipient_set_sha256:recipientSetHash};state.events.push({type:'EMAIL_GROUP_DECIDED',group_id:groupId,id:randomUUID(),decision,content_hash:contentHash,version:group.version,destination_ids:members});return state;
   });
  }
  async removeFromGroup(id,groupId,destinationId,contentHash,version,action){
   if(!['EXCLUDE','SPLIT'].includes(action))throw Error('INVALID_GROUP_ACTION');return this.mutate(id,state=>{
    if(!state||!isReviewPhase(state.phase))throw Error('REVIEW_NOT_OPEN');const group=state.email_groups?.[groupId];if(!group||group.content_hash!==contentHash||group.version!==version)throw Error('STALE_GROUP_VERSION');if(!group.destination_ids.includes(destinationId)||group.destination_ids.length<2)throw Error('INVALID_GROUP_MEMBER');if(state.deliveries[destinationId])throw Error('DECISION_AFTER_DISTRIBUTION');
    const priorApproval=state.group_approvals?.[groupId]??null;if(priorApproval){delete state.group_approvals[groupId];for(const memberId of group.destination_ids)delete state.decisions[memberId];}
    group.destination_ids=group.destination_ids.filter(memberId=>memberId!==destinationId);group.version++;delete state.decisions[destinationId];
    if(action==='EXCLUDE')state.decisions[destinationId]={authority:'OWNER',decision:'EXCLUDE',asset_sha256:state.assets[destinationId].fingerprint,campaign_id:id,destination_id:destinationId};else{const splitId=groupIdFor(id,[destinationId]);state.email_groups[splitId]={id:splitId,...groupContent(state.assets[destinationId].asset),destination_ids:[destinationId],version:1};}
    state.events.push({type:action==='EXCLUDE'?'EMAIL_GROUP_MEMBER_EXCLUDED':'EMAIL_GROUP_MEMBER_SPLIT',group_id:groupId,destination_id:destinationId,id:randomUUID(),content_hash:contentHash,new_version:group.version,previous_approval:priorApproval});return state;
   });
  }
  async claimDelivery(id,destinationId) {
    return this.mutate(id, state => {
      if (!state || state.phase !== 'PUBLICATION_REVIEW') throw Error('REVIEW_NOT_OPEN');
      const item = state.assets[destinationId];
      if (!item) throw Error('UNKNOWN_DESTINATION');
      if(item.asset.review_status==='NEEDS_REVISION')throw Error('INCOMPLETE_ASSET_NOT_SENDABLE');
      const prior = state.deliveries[destinationId];
      const ownerRecipientOverride=item.asset.kind==='EMAIL'&&item.asset.recipient_owner_override===true;
      if(item.asset.kind==='EMAIL'&&!ownerRecipientOverride)recipientPolicy.assertVerifiedAsset(item.asset,state.destinations.find(d=>d.id===destinationId));
      const key = assertSendable({asset:item.asset,approval:state.decisions[destinationId],receipt:prior});
      if(ownerRecipientOverride)recipientPolicy.assertSendableRecipient(item.asset,state.destinations.find(d=>d.id===destinationId),state.decisions[destinationId]);
      state.deliveries[destinationId] = {status:'ATTEMPTING',idempotency_key:key,claimed_at:new Date().toISOString()};
      return state;
    });
  }
  async recordDelivery(id,destinationId,status,receipt) {
    if (!['ACCEPTED','AMBIGUOUS','FAILED_DEFINITELY_UNSENT','CONFIRMED'].includes(status)) throw Error('INVALID_DELIVERY_RESULT');
    return this.mutate(id,state => {
      const prior=state?.deliveries[destinationId];
      if (!prior || !['ATTEMPTING','ACCEPTED','AMBIGUOUS'].includes(prior.status)) throw Error('DELIVERY_NOT_CLAIMED');
      if (prior.status==='ACCEPTED' && status!=='CONFIRMED') throw Error('ACCEPTED_STATUS_CANNOT_REGRESS');
      if (prior.status==='AMBIGUOUS' && status==='CONFIRMED' && !receipt?.provider_id) throw Error('CONFIRMATION_RECEIPT_REQUIRED');
      if (status==='ACCEPTED' && !receipt?.provider_id) throw Error('ACCEPTANCE_RECEIPT_REQUIRED');
      if (status==='FAILED_DEFINITELY_UNSENT' && !receipt?.independent_proof) throw Error('NONDELIVERY_PROOF_REQUIRED');
      if (status==='CONFIRMED' && !receipt?.provider_id) throw Error('CONFIRMATION_RECEIPT_REQUIRED');
      if (prior.status==='AMBIGUOUS' && status==='ACCEPTED' && !receipt?.provider_id) throw Error('ACCEPTANCE_RECEIPT_REQUIRED');
      if (prior.status==='ACCEPTED' && status==='FAILED_DEFINITELY_UNSENT') throw Error('ACCEPTED_CANNOT_BE_UNSENT');
      state.deliveries[destinationId]={...prior,status,receipt:structuredClone(receipt??null)};
      return state;
    });
  }
}
