import {GRAPHIC_STANDARD} from './graphic-standard.js';
import {assetFingerprint} from './contracts.js';
import {EDITORIAL_REFERENCE} from './editorial-reference.js';
import {cleanUnverifiedRecipients} from './verified-recipient-recovery.js';
import recipientPolicy from '../../../src/emradar-v3-recipient.cjs';
import {refreshUnreviewedEditorialDrafts} from './editorial-standard-refresh.js';
import {prepareEditorialAlternatives} from './editorial-alternatives.js';
import {createOpenAiPreparationProviders} from './openai-preparation-providers.js';
import {PostgresAdapter} from './adapters/postgres.js';
import {CampaignStore} from './state.js';
import {OutletDirectory} from './outlet-directory.js';
import {createDirectoryDiscovery} from './directory-discovery.js';
import {createReviewedEvidenceLinker} from './reviewed-evidence-links.js';
import {createEditorialContactResearch} from './editorial-contact-research.js';
import {lookup} from 'node:dns/promises';
import {pinnedHtml} from './autonomous-outlet-discovery.js';
import {createAutonomousOutletDiscovery} from './autonomous-outlet-discovery.js';
import {createPreparationRun,createVerifiedVisualRenderer} from './preparation-run.js';
import {ReviewWorkflow} from './review-workflow.js';
import {createPublicationReviewHandoff} from './publication-review-handoff.js';
import {sha256,MAX_DESTINATIONS,isReviewPhase} from './contracts.js';
import {verifyEditorialAsset} from './destination-selection.js';

export function selectPersistedDraftDestinations({candidates,document,existingIds=[]}) {
 const evidence=(document?.evidence??[]).filter(item=>item?.verified===true&&item?.id);
 const evidenceIds=new Set(evidence.map(item=>item.id));
 const scanDigest=sha256(JSON.stringify(evidence.map(item=>[item.id,item.fact,item.source_url])));
 const existing=new Set(existingIds),emails=new Set();
 return (candidates??[]).filter(candidate=>['EDITORIAL_PUBLICATION','INFORMATION_CHANNEL'].includes(candidate?.destination_class)&&recipientPolicy.verifiedPublication(candidate)&&!existing.has(candidate.id)&&candidate?.verification?.scan_evidence_digest===scanDigest).map(candidate=>{
  const ids=(candidate.verification.evidence_ids??[]).filter(id=>evidenceIds.has(id));
  const email=candidate.contact?.email?.toLowerCase();if(!ids.length||(email&&emails.has(email)))return null;if(email)emails.add(email);
  const deliveryEligible=candidate.contact_verified===true&&candidate.editorial_fit_verified===true&&Boolean(candidate.contact?.email)&&Boolean(candidate.contact?.source_url);
  return {...candidate,id:candidate.id,name:candidate.name,category:candidate.category,publication_type:candidate.publication_type,website:candidate.website,destination_class:candidate.destination_class,relationship:candidate.relationship,contact:deliveryEligible?candidate.contact:null,evidence:{ids},contact_verified:deliveryEligible,editorial_fit_verified:candidate.editorial_fit_verified===true,delivery_eligible:deliveryEligible,contact_status:deliveryEligible?'VERIFIED':'UNVERIFIED',draft_only:!deliveryEligible};
 }).filter(Boolean).slice(0,Math.max(0,MAX_DESTINATIONS-existing.size));
}

export function assessPublicationReview({state,candidates}) {
 if(!state||!isReviewPhase(state.phase)||!state.preparation_input?.document)return {complete:false,verified_publications:0,editorial_emails:0,x_ready:false,missing_destination_ids:[]};
 const evidence=state.preparation_input.document.evidence.filter(item=>item?.verified===true&&item?.id);
 const scanDigest=sha256(JSON.stringify(evidence.map(item=>[item.id,item.fact,item.source_url])));
 const publications=[...new Map([...(state.destinations??[]),...(candidates??[])].filter(candidate=>recipientPolicy.verifiedPublication(candidate)&&candidate?.verification?.scan_evidence_digest===scanDigest).map(candidate=>[candidate.id,candidate])).values()].slice(0,MAX_DESTINATIONS-1);
 const recipients=publications.filter(recipientPolicy.verifiedDestination);
 const destinationIds=new Set(state.destinations.map(item=>item.id));
 const assets=Object.values(state.assets??{}).map(item=>item?.asset).filter(Boolean);
 const emailIds=new Set(assets.filter(asset=>asset.kind==='EMAIL'&&asset.subject?.trim()&&asset.body?.trim()).map(asset=>asset.destination_id));
 const missing=recipients.filter(item=>!state.decisions?.[item.id]&&!state.deliveries?.[item.id]).map(item=>item.id).filter(id=>!destinationIds.has(id)||!emailIds.has(id));
 const incomplete=assets.filter(asset=>asset.review_status==='NEEDS_REVISION');
 const x=assets.find(asset=>asset.kind==='X'&&asset.destination_id==='x');
 const xReady=Boolean(x?.body&&(x.visual_url||x.visual_base64));
 const visible=(state.destinations??[]).every(destination=>assets.some(asset=>asset.destination_id===destination.id))&&publications.every(publication=>destinationIds.has(publication.id)&&assets.some(asset=>asset.destination_id===publication.id));
 return {complete:visible,review_ready:visible,delivery_ready:missing.length===0&&incomplete.length===0&&xReady,verified_publications:publications.length,verified_contacts:recipients.length,unresolved_contacts:publications.length-recipients.length,editorial_emails:emailIds.size,x_ready:xReady,needs_revision:incomplete.map(asset=>asset.destination_id),missing_destination_ids:missing};
}

// Explicit assembly of existing V3 workers. Call only after provider and
// owner-notification transports have been configured and independently tested.
// Does not mount HTTP routes, deploy, distribute or trigger a campaign at import.
export async function createPreparationReviewService({
 pool,reviewOrigin,notify,researchEvidence,write,renderVisual,reviewedLinks,fetcher,discoverLinks,openai,autonomousDiscovery=false
}) {
 if(typeof pool?.query!=='function'||typeof notify!=='function'||
    typeof researchEvidence!=='function'||typeof write!=='function'||
    typeof renderVisual!=='function'||!Array.isArray(reviewedLinks))
  throw Error('V3_PREPARATION_SERVICE_DEPENDENCIES_REQUIRED');
 const adapter=new PostgresAdapter(pool);
 const directory=new OutletDirectory(pool);
 await adapter.initialize();
 await directory.initialize();
 const store=new CampaignStore(adapter);
 const discover=createDirectoryDiscovery({
  directory,linkEvidence:autonomousDiscovery?async({document,outlets})=>createAutonomousOutletDiscovery({openai,directory,fetcher})({document,outlets}):discoverLinks??createReviewedEvidenceLinker({reviewedLinks})
 });
 const prepare=createPreparationRun({store,researchEvidence,discover,write,renderVisual,fetcher});
 const renderVerifiedVisual=createVerifiedVisualRenderer(renderVisual);
 const ensureBrandedX=async campaignId=>{
  const state=(await adapter.read(campaignId))?.value,entry=state?.assets?.x;
  if(!entry||entry.asset.visual_brand_version===GRAPHIC_STANDARD.version||state.decisions?.x||state.deliveries?.x)return;
  const asset=structuredClone(entry.asset);
  const visual=await renderVerifiedVisual({asset,document:state.preparation_input.document,scan:state.scan});
  asset.visual_sha256=visual.sha256;asset.visual_url=visual.url;if(visual.diagnostics)asset.visual_diagnostics=structuredClone(visual.diagnostics);
  // Injected providers may omit metadata; the shared branded provider owns the standard.
  asset.visual_brand_version=GRAPHIC_STANDARD.version;
  await store.mutate(campaignId,current=>{
   if(current.assets.x.fingerprint!==entry.fingerprint||current.decisions?.x||current.deliveries?.x)throw Error('X_REVIEW_CHANGED_DURING_PREPARATION');
   current.editorial_versions??={};current.editorial_versions.x??=[];current.editorial_versions.x.push(structuredClone(entry));
   current.assets.x={asset,fingerprint:assetFingerprint(asset)};current.events.push({type:'X_BRANDED_VISUAL_PREPARED'});return current;
  });
 };
 const workflow=new ReviewWorkflow({store,adapter,notify,baseUrl:reviewOrigin});
 const resumeEditorialDrafts=async (campaignId,{limit=MAX_DESTINATIONS,verifiedPublicationsOnly=false,existingDrafts={}}={})=>{
  const state=(await adapter.read(campaignId))?.value;
  if(!state||!isReviewPhase(state.phase)||!state.preparation_input?.document)throw Error('CAMPAIGN_NOT_READY');
  const destinations=selectPersistedDraftDestinations({candidates:(await directory.list()).filter(candidate=>!verifiedPublicationsOnly||candidate.verification?.status==='VERIFIED'),document:state.preparation_input.document,existingIds:[...state.destinations.map(item=>item.id),...Object.keys(state.decisions??{}),...Object.keys(state.deliveries??{})]});
  const evidenceIds=new Set(state.preparation_input.document.evidence.filter(item=>item.verified===true).map(item=>item.id));
  const assets=[];
  for(const destination of destinations.slice(0,limit)){
   const previous=existingDrafts[destination.id]?.asset;
   const compatible=previous?.kind==='EMAIL'&&previous.editorial_reference?.sha256===EDITORIAL_REFERENCE.sha256&&previous.evidence_ids?.every(id=>evidenceIds.has(id))&&previous.evidence_ids?.some(id=>destination.evidence.ids.includes(id));
   let asset;
   try{
    if(!destination.delivery_eligible)throw Error('V3_VERIFIED_RECIPIENT_REQUIRED');
    asset=compatible?{...structuredClone(previous),to:destination.contact.email,contact_status:'VERIFIED',delivery_eligible:true,recipient_verification:destination.contact}:await write({campaignId,destination,document:state.preparation_input.document,scan:state.scan});
    verifyEditorialAsset(asset,{evidenceIds});asset.review_status='READY';
   }catch(error){asset={campaign_id:campaignId,destination_id:destination.id,kind:'EMAIL',subject:'Preparation incomplete: '+(destination.name??destination.id),body:'Preparation did not complete for this item. Review the persisted warning and regenerate or exclude it.',from:'sean@emradar.net',evidence_ids:destination.evidence.ids.filter(id=>evidenceIds.has(id)),review_status:'NEEDS_REVISION',preparation_error:/^[A-Z0-9_]+$/.test(error?.message??'')?error.message:'EDITORIAL_PREPARATION_FAILED',delivery_eligible:false,contact_status:'UNVERIFIED'};}
   await store.extendReview(campaignId,[destination],[asset]);
   assets.push(asset);
  }
  return {campaignId,status:'PUBLICATION_REVIEW',editorial_drafts:assets.length,notification:'EXISTING_REVIEW_SESSION'};
 };
 const regenerateRejectedAsset=async(campaignId,destinationId,requestId)=>{
  const state=(await adapter.read(campaignId))?.value;
  const action=state?.review_actions?.[destinationId],entry=state?.assets?.[destinationId];
  if(!state||state.phase!=='PUBLICATION_REVIEW'||!entry||!action||action.request_id!==requestId||!['RUNNING','PENDING'].includes(action.status))throw Error('REGENERATION_REQUEST_STALE');
  if(!action.feedback?.trim())throw Error('OWNER_FEEDBACK_REQUIRED');
  if(entry.fingerprint!==action.asset_sha256||state.deliveries?.[destinationId])throw Error('REGENERATION_ASSET_STALE');
  const destination=state.destinations.find(item=>item.id===destinationId);
  if(!destination)throw Error('REGENERATION_DESTINATION_MISSING');
  const document=state.preparation_input?.document;
  if(!document)throw Error('REGENERATION_EVIDENCE_MISSING');
  const asset=await write({campaignId,destination,document,scan:state.scan,ownerFeedback:action.feedback});
  if(!asset||asset.campaign_id!==campaignId||asset.destination_id!==destinationId||asset.kind!==entry.asset.kind)throw Error('REGENERATION_ASSET_MISMATCH');
  if(asset.kind==='X'){
   const visual=await renderVerifiedVisual({asset,document,scan:state.scan});
   asset.visual_sha256=visual.sha256;asset.visual_url=visual.url;asset.visual_brand_version=asset.visual_brand_version||GRAPHIC_STANDARD.version;if(visual.diagnostics)asset.visual_diagnostics=structuredClone(visual.diagnostics);
  }
  const evidenceIds=new Set(document.evidence.filter(item=>item?.verified===true).map(item=>item.id));
  verifyEditorialAsset(asset,{evidenceIds});
  asset.review_status='READY';
  const revisionId=action.revision_id;
  const nextFingerprint=assetFingerprint(asset);
  await store.mutate(campaignId,current=>{
   const currentAction=current?.review_actions?.[destinationId],currentEntry=current?.assets?.[destinationId];
   if(!current||current.phase!=='PUBLICATION_REVIEW'||currentAction?.request_id!==requestId||!['RUNNING','PENDING'].includes(currentAction.status)||currentEntry?.fingerprint!==action.asset_sha256||current.deliveries?.[destinationId])throw Error('REGENERATION_ASSET_STALE');
   current.editorial_versions??={};current.editorial_versions[destinationId]??=[];
   current.editorial_versions[destinationId].push({...structuredClone(currentEntry),label:'Owner-rejected revision',rejection:structuredClone(current.decisions?.[destinationId]??null),feedback:action.feedback,revision_id:requestId});
   current.assets[destinationId]={asset:structuredClone(asset),fingerprint:nextFingerprint};
   delete current.decisions[destinationId];
   current.review_actions[destinationId]={...currentAction,status:'OWNER_REVIEW_PENDING',generated_at:new Date().toISOString(),new_asset_sha256:nextFingerprint,revision_id:revisionId};
   current.events??=[];current.events.push({type:'OWNER_FEEDBACK_REVISION_CREATED',destination_id:destinationId,request_id:requestId,previous_fingerprint:action.asset_sha256,new_fingerprint:nextFingerprint});
   return current;
  });
  const completion=await reviewCompletion(campaignId);
  await store.mutate(campaignId,current=>{current.review_completion=completion;current.phase='PUBLICATION_REVIEW';return current;});
  return {campaignId,destinationId,requestId,revisionId,fingerprint:nextFingerprint,status:'OWNER_REVIEW_PENDING'};
 };
 const updateRegenerationStatus=async(campaignId,destinationId,requestId,status,details={})=>store.mutate(campaignId,current=>{
  const action=current?.review_actions?.[destinationId];
  if(!action||action.request_id!==requestId)return current;
  current.review_actions[destinationId]={...action,...details,status,updated_at:new Date().toISOString()};
  return current;
 });
 const ensureOwnerReview=async campaignId=>{
  const existing=(await adapter.read('review:'+campaignId))?.value;
  if(existing){
   if(['NOTIFIED','CONSUMED'].includes(existing.status))return {campaignId,status:'NOTIFIED',existing:true};
   throw Error('REVIEW_NOTIFICATION_UNCONFIRMED');
  }
  return workflow.issue(campaignId);
 };
 const saveCompletion=async campaignId=>{
  const completion=await reviewCompletion(campaignId);
  await store.mutate(campaignId,current=>{
   const phase=completion.complete?'PUBLICATION_REVIEW':'ASSETS_PREPARED';
   if(current.phase!==phase)current.events.push({type:completion.complete?'PUBLICATION_REVIEW_READY':'PREPARATION_INCOMPLETE'});
   current.phase=phase;current.review_completion=completion;return current;
  });
  return completion;
 };
 const resumeIntelligentDiscovery=async (campaignId,{notifyOwner=true}={})=>{
  const state=(await adapter.read(campaignId))?.value;
  if(!state||!isReviewPhase(state.phase)||!state.preparation_input?.document)throw Error('CAMPAIGN_NOT_READY');
  await saveCompletion(campaignId);
  let resumed,completion;
  try{
   await ensureBrandedX(campaignId);
   await discover({scan:state.scan,document:state.preparation_input.document,history:[]});
   resumed=await resumeEditorialDrafts(campaignId);
  }finally{completion=await saveCompletion(campaignId);}
  const notification=completion.complete&&notifyOwner?await ensureOwnerReview(campaignId):null;
  return {...resumed,status:completion.complete?'PUBLICATION_REVIEW':'ASSETS_PREPARED',...completion,notification:notification?.status??(completion.complete?'NOT_REQUESTED':'NOT_READY')};
 };
 const recoverVerifiedRecipients=async campaignId=>{
  const cleanup=await cleanUnverifiedRecipients({pool,campaignId});
  const state=(await adapter.read(campaignId))?.value;
  if(!isReviewPhase(state?.phase)||!state.preparation_input?.document)throw Error('CAMPAIGN_NOT_READY');
  const before={x:sha256(state.assets.x),decisions:sha256(state.decisions),evidence:sha256(state.preparation_input),deliveries:sha256(state.deliveries)};
  await createAutonomousOutletDiscovery({openai,directory})({document:state.preparation_input.document,outlets:await directory.list(),candidateHints:cleanup.hints});
  const result=await resumeEditorialDrafts(campaignId,{existingDrafts:cleanup.assets});
  const after=(await adapter.read(campaignId))?.value;
  if(before.x!==sha256(after.assets.x)||before.decisions!==sha256(after.decisions)||before.evidence!==sha256(after.preparation_input)||before.deliveries!==sha256(after.deliveries))throw Error('RECIPIENT_RECOVERY_PRESERVATION_FAILED');
  const active=typeof directory.listContactVerified==='function'?await directory.listContactVerified():(await directory.list()).filter(recipientPolicy.verifiedDestination);
  if(active.some(item=>!recipientPolicy.verifiedDestination(item))||after.destinations.some(item=>item.id!=='x'&&!recipientPolicy.verifiedDestination(item)))throw Error('RECIPIENT_RECOVERY_INVARIANT_FAILED');
  return {...result,directory_removed:cleanup.directory_removed,campaign_destinations_removed:cleanup.campaign_destinations_removed,verified_recipients:active.length,owner_decisions_preserved:true,x_unchanged:true,external_distribution:0};
 };
 const reviewCompletion=async campaignId=>assessPublicationReview({state:(await adapter.read(campaignId))?.value,candidates:await directory.list()});
 return {store,directory,workflow,prepare,discover,cleanUnverifiedRecipients:campaignId=>cleanUnverifiedRecipients({pool,campaignId}),recoverVerifiedRecipients,testProductionContactAccess:()=>createEditorialContactResearch({read:url=>pinnedHtml(url,lookup),maxPages:4,maxMs:45000})({website:'https://www.australianmining.com.au/',publication:'Australian Mining',topics:['mining'],sourceUrls:['https://www.australianmining.com.au/contact-us/']}),refreshUnreviewedEditorialDrafts:campaignId=>refreshUnreviewedEditorialDrafts({store,write,campaignId}),prepareEditorialAlternatives:options=>prepareEditorialAlternatives({...options,store,write}),resumeEditorialDrafts,resumeIntelligentDiscovery,reviewCompletion,regenerateRejectedAsset,updateRegenerationStatus,prepareAndNotify:createPublicationReviewHandoff({prepare:async input=>{
  const result=await prepare(input);
  const prior=(await adapter.read(result.campaignId))?.value;
  if(result.status==='ALREADY_PREPARED'&&!prior?.review_completion)await resumeIntelligentDiscovery(result.campaignId,{notifyOwner:false});
  let completion=await saveCompletion(result.campaignId);
  if(!completion.complete){
   if(result.status==='ALREADY_PREPARED')await resumeIntelligentDiscovery(result.campaignId,{notifyOwner:false});
   else await resumeEditorialDrafts(result.campaignId,{verifiedPublicationsOnly:true});
   completion=await saveCompletion(result.campaignId);
  }
  if(!completion.complete)throw Error('V3_PUBLICATION_REVIEW_INCOMPLETE');
  return {...result,status:'PUBLICATION_REVIEW',...completion};
 },workflow:{issue:ensureOwnerReview}})};
}

// Convenience composition for the paid API's existing OpenAI connection.
// Caller still controls activation, review notification and all external effects.
export async function createOpenAiPreparationReviewService({openai,...options}) {
 const providers=createOpenAiPreparationProviders({openai});
 return createPreparationReviewService({...options,...providers,openai});
}
