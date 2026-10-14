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
 return (candidates??[]).filter(candidate=>candidate?.active===true&&!existing.has(candidate.id)&&candidate?.verification?.scan_evidence_digest===scanDigest).map(candidate=>{
  const ids=(candidate.verification.evidence_ids??[]).filter(id=>evidenceIds.has(id));
  if(!ids.length)return null;
  const deliveryEligible=candidate.contact_verified===true&&candidate.editorial_fit_verified===true&&Boolean(candidate.contact?.email)&&Boolean(candidate.contact?.source_url);
  return {id:candidate.id,name:candidate.name,category:candidate.category,contact:deliveryEligible?candidate.contact:null,evidence:{ids},contact_verified:deliveryEligible,editorial_fit_verified:candidate.editorial_fit_verified===true,delivery_eligible:deliveryEligible,contact_status:deliveryEligible?'VERIFIED':'UNVERIFIED',draft_only:!deliveryEligible};
 }).filter(Boolean).slice(0,Math.max(0,MAX_DESTINATIONS-existing.size));
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
 const resumeEditorialDrafts=async campaignId=>{
  const state=(await adapter.read(campaignId))?.value;
  if(!state||state.phase!=='PUBLICATION_REVIEW'||!state.preparation_input?.document)throw Error('CAMPAIGN_NOT_READY');
  const destinations=selectPersistedDraftDestinations({candidates:await directory.list(),document:state.preparation_input.document,existingIds:state.destinations.map(item=>item.id)});
  const evidenceIds=new Set(state.preparation_input.document.evidence.filter(item=>item.verified===true).map(item=>item.id));
  const assets=[];
  for(const destination of destinations){
   const asset=await write({campaignId,destination,document:state.preparation_input.document,scan:state.scan});
   verifyEditorialAsset(asset,{evidenceIds});
   assets.push(asset);
  }
  if(destinations.length)await store.extendReview(campaignId,destinations,assets);
  return {campaignId,status:'PUBLICATION_REVIEW',editorial_drafts:assets.length,notification:'EXISTING_REVIEW_SESSION'};
 };
 return {store,directory,workflow,prepare,discover,resumeEditorialDrafts,prepareAndNotify:createPublicationReviewHandoff({prepare,workflow})};
}

// Convenience composition for the paid API's existing OpenAI connection.
// Caller still controls activation, review notification and all external effects.
export async function createOpenAiPreparationReviewService({openai,...options}) {
 const providers=createOpenAiPreparationProviders({openai});
 return createPreparationReviewService({...options,...providers,openai});
}
