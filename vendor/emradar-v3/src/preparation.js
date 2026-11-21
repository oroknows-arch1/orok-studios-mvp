import {isReviewPhase} from './contracts.js';
import {verifyEditorialAsset} from './destination-selection.js';
import {assertDestinations} from './contracts.js';
import {envelopeSharedEmail,planPreparationBatches} from './group-first-preparation.js';

const failureCode=error=>/^[A-Z0-9_]+$/.test(error?.message??'')?error.message:'PREPARATION_WORKER_FAILED';
const incompleteAsset=({campaignId,destination,evidenceIds,error})=>({
 campaign_id:campaignId,destination_id:destination.id,kind:destination.id==='x'?'X':'EMAIL',
 subject:destination.id==='x'?'X draft needs revision':'Preparation incomplete: '+(destination.name??destination.id),
 body:'Preparation did not complete for this item. Review the persisted warning and regenerate or exclude it.',
 from:'sean@emradar.net',evidence_ids:[...(destination.evidence?.ids??[])].filter(id=>evidenceIds.has(id)),
 review_status:'NEEDS_REVISION',preparation_error:failureCode(error),delivery_eligible:false,contact_status:'UNVERIFIED'
});

export class CampaignPreparation {
 constructor({store,discover,write,renderVisual}) {
  if(!store?.select || typeof discover!=='function' || typeof write!=='function' || typeof renderVisual!=='function') throw Error('PREPARATION_DEPENDENCIES_REQUIRED');
  this.store=store;this.discover=discover;this.write=write;this.renderVisual=renderVisual;
 }
 async prepare({scan,document,history=[]}) {
  const campaignId=await this.store.start(scan);
  const existing=(await this.store.adapter.read(campaignId))?.value;
  if(isReviewPhase(existing?.phase)) return {campaignId,status:'ALREADY_PREPARED'};
  if(existing?.phase!=='SCAN_VERIFIED' && existing?.phase!=='DESTINATIONS_SELECTED') throw Error('CAMPAIGN_PHASE_UNSUPPORTED');
  const warnings=[];
  let destinations;
  if(existing.phase==='DESTINATIONS_SELECTED') destinations=existing.destinations;
  else {
   try{destinations=await this.discover({scan,document,history});}
   catch(error){
    warnings.push({stage:'DISCOVERY',code:failureCode(error)});
    destinations=[{id:'x',category:'social',contact_verified:true,evidence:{ids:(document?.evidence??[]).filter(e=>e?.verified===true).map(e=>e.id)}}];
   }
   assertDestinations(destinations);
   if(!destinations.some(d=>d.id==='x')) throw Error('MANDATORY_X_MISSING');
   await this.store.select(campaignId,destinations);
  }
  const verifiedEvidence=new Set((document?.evidence??[]).filter(e=>e.verified===true).map(e=>e.id));
  const assets=[];
  const prepareAsset=async(destination,sharedDestinations=null)=>{
   let asset;
   try{
    asset=await this.write({campaignId,destination,document,scan,...(sharedDestinations?{sharedDestinations}: {})});
   // The mandatory X destination must produce an X asset with a graphic.
   if(destination.id==='x' && asset?.kind!=='X') throw Error('X_ASSET_KIND_MISMATCH');
   if(destination.id!=='x' && asset?.kind==='X') throw Error('X_ASSET_DESTINATION_MISMATCH');
   if(asset.kind==='X') {
    if(destination.id!=='x') throw Error('INVALID_X_DESTINATION');
    const visual=await this.renderVisual({asset,document,scan});
    if(!visual?.sha256 || !/^[a-f0-9]{64}$/.test(visual.sha256) || !visual.url) throw Error('X_VISUAL_UNAVAILABLE');
    asset.visual_sha256=visual.sha256;
    asset.visual_url=visual.url;
    if(visual.diagnostics)asset.visual_diagnostics=structuredClone(visual.diagnostics);
   }
   verifyEditorialAsset(asset,{evidenceIds:verifiedEvidence});
   if(asset.campaign_id!==campaignId || asset.destination_id!==destination.id) throw Error('CROSS_CAMPAIGN_ASSET');
    asset.review_status='READY';return asset;
   }catch(error){
    const code=failureCode(error);warnings.push({stage:destination.id==='x'?'X_PREPARATION':'EDITORIAL_PREPARATION',destination_id:destination.id,code});
    return incompleteAsset({campaignId,destination,evidenceIds:verifiedEvidence,error});
   }
  };
  for(const batch of planPreparationBatches(destinations)) {
   if(batch.length>1){
    const shared=await prepareAsset(batch[0],batch);
    if(shared.review_status==='READY'&&shared.kind==='EMAIL'){
     const candidates=batch.map(destination=>envelopeSharedEmail(shared,destination));
     try{for(const asset of candidates)verifyEditorialAsset(asset,{evidenceIds:verifiedEvidence});assets.push(...candidates);continue;}catch{}
    }
   }
   for(const destination of batch)assets.push(await prepareAsset(destination));
  }
  await this.store.prepare(campaignId,assets,warnings);
  return {campaignId,status:'PUBLICATION_REVIEW',assets:assets.length,warnings:warnings.length};
 }
}
