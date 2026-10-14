import {verifyEditorialAsset} from './destination-selection.js';
import {assertDestinations} from './contracts.js';

export class CampaignPreparation {
 constructor({store,discover,write,renderVisual}) {
  if(!store?.select || typeof discover!=='function' || typeof write!=='function' || typeof renderVisual!=='function') throw Error('PREPARATION_DEPENDENCIES_REQUIRED');
  this.store=store;this.discover=discover;this.write=write;this.renderVisual=renderVisual;
 }
 async prepare({scan,document,history=[]}) {
  const campaignId=await this.store.start(scan);
  const existing=(await this.store.adapter.read(campaignId))?.value;
  if(existing?.phase==='PUBLICATION_REVIEW') return {campaignId,status:'ALREADY_PREPARED'};
  if(existing?.phase!=='SCAN_VERIFIED' && existing?.phase!=='DESTINATIONS_SELECTED') throw Error('CAMPAIGN_PHASE_UNSUPPORTED');
  let destinations;
  if(existing.phase==='DESTINATIONS_SELECTED') destinations=existing.destinations;
  else {
   destinations=await this.discover({scan,document,history});
   assertDestinations(destinations);
   if(!destinations.some(d=>d.id==='x')) throw Error('MANDATORY_X_MISSING');
   await this.store.select(campaignId,destinations);
  }
  const verifiedEvidence=new Set((document?.evidence??[]).filter(e=>e.verified===true).map(e=>e.id));
  if(!verifiedEvidence.size) throw Error('NO_VERIFIED_EVIDENCE');
  const assets=[];
  for(const destination of destinations) {
   const asset=await this.write({campaignId,destination,document,scan});
   // The mandatory X destination must produce an X asset with a graphic.
   if(destination.id==='x' && asset?.kind!=='X') throw Error('X_ASSET_KIND_MISMATCH');
   if(destination.id!=='x' && asset?.kind==='X') throw Error('X_ASSET_DESTINATION_MISMATCH');
   if(asset.kind==='X') {
    if(destination.id!=='x') throw Error('INVALID_X_DESTINATION');
    const visual=await this.renderVisual({asset,document,scan});
    if(!visual?.sha256 || !/^[a-f0-9]{64}$/.test(visual.sha256) || !visual.url) throw Error('X_VISUAL_UNAVAILABLE');
    asset.visual_sha256=visual.sha256;
    asset.visual_url=visual.url;
   }
   verifyEditorialAsset(asset,{evidenceIds:verifiedEvidence});
   if(asset.campaign_id!==campaignId || asset.destination_id!==destination.id) throw Error('CROSS_CAMPAIGN_ASSET');
   assets.push(asset);
  }
  await this.store.prepare(campaignId,assets);
  return {campaignId,status:'PUBLICATION_REVIEW',assets:assets.length};
 }
}
