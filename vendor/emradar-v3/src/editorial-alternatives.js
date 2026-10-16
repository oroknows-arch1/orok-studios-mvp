import {assetFingerprint} from './contracts.js';
import {verifyEditorialAsset} from './destination-selection.js';

// Owner-requested writing samples only. No discovery, images, notification,
// approval or distribution dependency is available to this worker.
export async function prepareEditorialAlternatives({store,write,campaignId,requestId,angles}) {
 if(!requestId||!Array.isArray(angles)||angles.length!==2)throw Error('TWO_EDITORIAL_ANGLES_REQUIRED');
 let state=await store.mutate(campaignId,current=>{
  if(!current||current.phase!=='PUBLICATION_REVIEW')throw Error('REVIEW_NOT_OPEN');
  if(current.editorial_rewrite?.request_id===requestId)return current;
  if(current.editorial_rewrite)throw Error('EDITORIAL_REWRITE_ALREADY_EXISTS');
  const entries=Object.entries(current.assets).filter(([,entry])=>entry.asset.kind==='EMAIL'&&entry.asset.correspondence_type==='EDITORIAL_OUTREACH');
  if(!entries.length)throw Error('NO_EDITORIAL_DRAFTS');
  if(entries.some(([id])=>current.deliveries[id]))throw Error('REVISION_AFTER_DISTRIBUTION');
  const history=entries.map(([id,entry])=>({destination_id:id,asset:structuredClone(entry.asset),fingerprint:entry.fingerprint,previous_decision:current.decisions[id]??null,rejection:{authority:'OWNER',decision:'REJECT',reason:'OWNER_REJECTED_WRITING_STANDARD',asset_sha256:entry.fingerprint}}));
  for(const [id,entry] of entries)current.decisions[id]={authority:'OWNER',decision:'REJECT',asset_sha256:entry.fingerprint,campaign_id:campaignId,destination_id:id};
  current.editorial_rewrite={request_id:requestId,status:'STARTED',rejected:history,variants:[],attempted:[],reference_thread:'1a0f640622c1fefe'};
  current.events.push({type:'OWNER_EDITORIAL_REJECTION',request_id:requestId,destination_ids:entries.map(([id])=>id)});
  return current;
 });
 const job=state.editorial_rewrite;
 if(job.status==='COMPLETE'||job.status==='FAILED')return {status:job.status,rejected:job.rejected.length,variants:job.variants.length};
 const destination=state.destinations.find(d=>d.id===job.rejected[0].destination_id);
 if(!destination||!state.preparation_input?.document)throw Error('EDITORIAL_INPUT_MISSING');
 const document={...state.preparation_input.document,uncertainty:[job.rejected[0].asset.evidence_limitations].filter(Boolean)};
 const evidenceIds=new Set(document.evidence.filter(e=>e.verified===true).map(e=>e.id));
 for(let index=0;index<2;index++){
  if(job.variants.some(v=>v.index===index))continue;
  if(job.attempted.includes(index))throw Error('EDITORIAL_ATTEMPT_OUTCOME_UNKNOWN');
  await store.mutate(campaignId,current=>{
   current.editorial_rewrite.attempted.push(index);return current;
  });
  try{
   const asset=await write({campaignId,destination,document,editorialAngle:angles[index]});
   if(asset.kind!=='EMAIL'||asset.campaign_id!==campaignId||asset.destination_id!==destination.id)throw Error('CROSS_CAMPAIGN_ASSET');
   verifyEditorialAsset(asset,{evidenceIds});
   await store.mutate(campaignId,current=>{
    current.editorial_rewrite.variants.push({index,id:requestId+':'+(index+1),status:'OWNER_REVIEW',asset,fingerprint:assetFingerprint(asset)});
    return current;
   });
  }catch(error){
   await store.mutate(campaignId,current=>{
    current.editorial_rewrite.status='FAILED';
    current.editorial_rewrite.failure=/^[A-Z0-9_]+$/.test(error.message)?error.message:'EDITORIAL_PROVIDER_FAILED';return current;
   });
   throw error;
  }
 }
 await store.mutate(campaignId,current=>{current.editorial_rewrite.status='COMPLETE';return current;});
 return {status:'COMPLETE',rejected:job.rejected.length,variants:2};
}
