'use strict';
// Composition for an independently invoked audience worker/review controller.
// Nothing imports this from V3. No scheduler, credential or external call at import.
async function createIndependentAudience({audiencePool,readSource,readOwnerAccess,authenticateOwner,loadPublishedBytes,x,writePosts,pilot,researchOptions={},publishEnabled=false}){
 if(typeof authenticateOwner!=='function')throw Error('AUDIENCE_OWNER_AUTHENTICATION_REQUIRED');
 const {CampaignStore}=await import('../vendor/emradar-v3/src/state.js');
 const {AudienceAdapter}=require('./emradar-audience-isolated-store.cjs');
 const {ThreadStore}=require('./emradar-x-thread-store.cjs');
 const adapter=new AudienceAdapter({pool:audiencePool,readSource,readOwnerAccess});await adapter.initialize();
 const store=new CampaignStore(adapter),threadStore=new ThreadStore(audiencePool);await threadStore.initialize();await threadStore.initializeOriginals();
 const review=require('./emradar-audience-v3-review.cjs').createV3AudienceReview({store,loadPublishedBytes,writePosts});
 review.setPublicationRowsReader(id=>threadStore.list(id));
 async function individualApproved(id,sha){const state=(await adapter.read(id))?.value,r=state?.audience_x_review;return !!r&&r.mode==='STANDALONE'&&r.manifest_sha256===sha&&r.segments.every(s=>{const d=state.audience_post_decisions?.[s.record_id];return d?.decision==='APPROVE'&&d.asset_sha256===s.asset_sha256&&d.manifest_sha256===sha;});}
 const guardedReview={verify:async input=>{const state=(await adapter.read(input.campaign_id))?.value;return await individualApproved(input.campaign_id,state?.audience_x_review?.manifest_sha256)&&await review.verify(input)}};
 const publish=require('./emradar-audience-v3-publication.cjs').createV3ThreadPublication({campaignStore:store,threadStore,review:guardedReview,x,enabled:publishEnabled});
 const research=pilot?require('./emradar-grok-full-scan.cjs').createFullScanResearch({...researchOptions,store,pilot,loadPublishedBytes,loadPublicationRows:id=>threadStore.list(id)}):null;
 const {createHash}=require('node:crypto');
 const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
 async function owner(id,session,secret,action){await authenticateOwner(id,session,secret);return action();}
 return {
  prepare:async id=>{await adapter.importSource(id);return review.prepare(id)},
  view:(id,session,secret)=>owner(id,session,secret,async()=>{const xThread=await review.view(id),state=(await adapter.read(id))?.value;for(const result of Object.values(xThread.research?.results??{}))for(const o of result.report?.opportunities??[])if(o.draft_text)o.review_sha256=digest({action_id:o.action_id,type:o.type,url:o.url,evidence_ids:o.evidence_ids,text:o.draft_text});return {campaignId:id,phase:'PUBLICATION_REVIEW',entries:[],xThread:{...xThread,post_decisions:state?.audience_post_decisions??{}}};}),
  present:(id,session,secret,input)=>owner(id,session,secret,()=>review.present(id,session,input)),
  decide:(id,session,secret,decision,sha)=>owner(id,session,secret,async()=>{if(decision==='APPROVE'&&!await individualApproved(id,sha))throw Error('AUDIENCE_INDIVIDUAL_APPROVALS_REQUIRED');return review.decide(id,session,decision,sha);}),
  postDecision:(id,session,secret,recordId,decision,sha,assetHash)=>owner(id,session,secret,()=>store.mutate(id,state=>{const r=state.audience_x_review;if(state.audience_x_publication_started||r?.manifest_sha256!==sha)throw Error('AUDIENCE_DECISION_STALE');const segment=r.segments.find(s=>s.record_id===recordId);if(!segment||segment.asset_sha256!==assetHash||!['APPROVE','REJECT'].includes(decision))throw Error('AUDIENCE_DECISION_INVALID');state.audience_post_decisions??={};state.audience_post_decisions[recordId]={decision,asset_sha256:assetHash,manifest_sha256:sha,session_id:session};delete state.audience_x_approval;delete state.audience_x_checks;state.events.push({type:'OWNER_X_POST_DECISION',record_id:recordId,decision,asset_sha256:assetHash,manifest_sha256:sha});return state;})),
  replyAction:(id,session,secret,discoveryId,actionId,action,sha,text)=>owner(id,session,secret,()=>store.mutate(id,state=>{const items=state.audience_x_research?.results?.[discoveryId]?.report?.opportunities;const o=items?.find(item=>item.action_id===actionId);if(!o||!['REPLY','QUOTE'].includes(o.type)||typeof o.draft_text!=='string')throw Error('AUDIENCE_REPLY_INVALID');const identity=()=>digest({action_id:o.action_id,type:o.type,url:o.url,evidence_ids:o.evidence_ids,text:o.draft_text});if(sha!==identity())throw Error('AUDIENCE_REPLY_STALE');if(action==='EDIT'){if(typeof text!=='string'||!require('./emradar-x-thread-text.cjs').validText(text))throw Error('AUDIENCE_REPLY_INVALID');o.draft_text=text;delete o.owner_decision;}else if(['APPROVE','REJECT','EXCLUDE'].includes(action)){o.owner_decision={decision:action,asset_sha256:sha,session_id:session};}else throw Error('AUDIENCE_REPLY_INVALID');o.review_sha256=identity();state.events.push({type:'OWNER_X_REPLY_REVIEW',action_id:actionId,action,asset_sha256:o.review_sha256});return state;})),
  revise:(id,session,secret,sha,changes)=>owner(id,session,secret,()=>review.revise(id,sha,changes)),
  run:async id=>{const result=await publish(id);if(result.status==='COMPLETE'&&research)await research(id);return result;}
 };
}
module.exports={createIndependentAudience};
