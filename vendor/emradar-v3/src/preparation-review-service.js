import {prepareEditorialAlternatives} from './editorial-alternatives.js';
import {createOpenAiPreparationProviders} from './openai-preparation-providers.js';
import {PostgresAdapter} from './adapters/postgres.js';
import {CampaignStore} from './state.js';
import {OutletDirectory} from './outlet-directory.js';
import {createDirectoryDiscovery} from './directory-discovery.js';
import {createReviewedEvidenceLinker} from './reviewed-evidence-links.js';
import {createAutonomousOutletDiscovery} from './autonomous-outlet-discovery.js';
import {createPreparationRun} from './preparation-run.js';
import {ReviewWorkflow} from './review-workflow.js';
import {createPublicationReviewHandoff} from './publication-review-handoff.js';
import {sha256,MAX_DESTINATIONS} from './contracts.js';
import {verifyEditorialAsset} from './destination-selection.js';

export function selectPersistedDraftDestinations({candidates,document,existingIds=[]}) {
 const evidence=(document?.evidence??[]).filter(item=>item?.verified===true&&item?.id);
 const evidenceIds=new Set(evidence.map(item=>item.id));
 const scanDigest=sha256(JSON.stringify(evidence.map(item=>[item.id,item.fact,item.source_url])));
 const existing=new Set(existingIds);
 return (candidates??[]).filter(candidate=>['EDITORIAL_PUBLICATION','INFORMATION_CHANNEL'].includes(candidate?.destination_class)&&candidate?.active===true&&!existing.has(candidate.id)&&candidate?.verification?.scan_evidence_digest===scanDigest).map(candidate=>{
  const ids=(candidate.verification.evidence_ids??[]).filter(id=>evidenceIds.has(id));
  if(!ids.length)return null;
  const deliveryEligible=candidate.contact_verified===true&&candidate.editorial_fit_verified===true&&Boolean(candidate.contact?.email)&&Boolean(candidate.contact?.source_url);
  return {id:candidate.id,name:candidate.name,category:candidate.category,publication_type:candidate.publication_type,website:candidate.website,destination_class:candidate.destination_class,relationship:candidate.relationship,contact:deliveryEligible?candidate.contact:null,evidence:{ids},contact_verified:deliveryEligible,editorial_fit_verified:candidate.editorial_fit_verified===true,delivery_eligible:deliveryEligible,contact_status:deliveryEligible?'VERIFIED':'UNVERIFIED',draft_only:!deliveryEligible};
 }).filter(Boolean).slice(0,Math.max(0,MAX_DESTINATIONS-existing.size));
}

export function assessPublicationReview({state,candidates}) {
 if(!state||state.phase!=='PUBLICATION_REVIEW'||!state.preparation_input?.document)return {complete:false,verified_publications:0,editorial_emails:0,x_ready:false,missing_destination_ids:[]};
 const evidence=state.preparation_input.document.evidence.filter(item=>item?.verified===true&&item?.id);
 const scanDigest=sha256(JSON.stringify(evidence.map(item=>[item.id,item.fact,item.source_url])));
 const publications=(candidates??[]).filter(candidate=>['EDITORIAL_PUBLICATION','INFORMATION_CHANNEL'].includes(candidate?.destination_class)&&candidate?.active===true&&candidate?.editorial_fit_verified===true&&candidate?.verification?.status==='VERIFIED'&&candidate?.verification?.scan_evidence_digest===scanDigest);
 const destinationIds=new Set(state.destinations.map(item=>item.id));
 const assets=Object.values(state.assets??{}).map(item=>item?.asset).filter(Boolean);
 const emailIds=new Set(assets.filter(asset=>asset.kind==='EMAIL').map(asset=>asset.destination_id));
 const missing=publications.map(item=>item.id).filter(id=>!destinationIds.has(id)||!emailIds.has(id));
 const x=assets.find(asset=>asset.kind==='X'&&asset.destination_id==='x');
 const xReady=Boolean(x?.body&&(x.visual_url||x.visual_base64));
 return {complete:publications.length>0&&missing.length===0&&xReady,verified_publications:publications.length,editorial_emails:publications.length-missing.length,x_ready:xReady,missing_destination_ids:missing};
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
 const workflow=new ReviewWorkflow({store,adapter,notify,baseUrl:reviewOrigin});
 const resumeEditorialDrafts=async (campaignId,{limit=MAX_DESTINATIONS,verifiedPublicationsOnly=false}={})=>{
  const state=(await adapter.read(campaignId))?.value;
  if(!state||state.phase!=='PUBLICATION_REVIEW'||!state.preparation_input?.document)throw Error('CAMPAIGN_NOT_READY');
  const destinations=selectPersistedDraftDestinations({candidates:(await directory.list()).filter(candidate=>!verifiedPublicationsOnly||candidate.verification?.status==='VERIFIED'),document:state.preparation_input.document,existingIds:state.destinations.map(item=>item.id)});
  const evidenceIds=new Set(state.preparation_input.document.evidence.filter(item=>item.verified===true).map(item=>item.id));
  const assets=[];
  for(const destination of destinations.slice(0,limit)){
   const asset=await write({campaignId,destination,document:state.preparation_input.document,scan:state.scan});
   verifyEditorialAsset(asset,{evidenceIds});
   await store.extendReview(campaignId,[destination],[asset]);
   assets.push(asset);
  }
  return {campaignId,status:'PUBLICATION_REVIEW',editorial_drafts:assets.length,notification:'EXISTING_REVIEW_SESSION'};
 };
 const resumeIntelligentDiscovery=async campaignId=>{
  const state=(await adapter.read(campaignId))?.value;
  if(!state||state.phase!=='PUBLICATION_REVIEW'||!state.preparation_input?.document)throw Error('CAMPAIGN_NOT_READY');
  await discover({scan:state.scan,document:state.preparation_input.document,history:[]});
  const resumed=await resumeEditorialDrafts(campaignId);
  return {...resumed,...await reviewCompletion(campaignId)};
 };
 const reviewCompletion=async campaignId=>assessPublicationReview({state:(await adapter.read(campaignId))?.value,candidates:await directory.list()});
 return {store,directory,workflow,prepare,discover,prepareEditorialAlternatives:options=>prepareEditorialAlternatives({...options,store,write}),resumeEditorialDrafts,resumeIntelligentDiscovery,reviewCompletion,prepareAndNotify:createPublicationReviewHandoff({prepare:async input=>{
  const result=await prepare(input);
  await resumeEditorialDrafts(result.campaignId,{verifiedPublicationsOnly:true});
  const completion=await reviewCompletion(result.campaignId);
  if(!completion.complete)throw Error('V3_PUBLICATION_REVIEW_INCOMPLETE');
  return result;
 },workflow})};
}

// Convenience composition for the paid API's existing OpenAI connection.
// Caller still controls activation, review notification and all external effects.
export async function createOpenAiPreparationReviewService({openai,...options}) {
 const providers=createOpenAiPreparationProviders({openai});
 return createPreparationReviewService({...options,...providers,openai});
}
