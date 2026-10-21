import {EDITORIAL_REFERENCE,EDITORIAL_ENFORCEMENT_VERSION,isEditorialDestination} from './editorial-reference.js';
import {verifyEditorialAsset} from './destination-selection.js';
import {assetFingerprint} from './contracts.js';

export async function refreshUnreviewedEditorialDrafts({store,write,campaignId}){
 const original=(await store.adapter.read(campaignId))?.value;
 if(original?.phase!=='PUBLICATION_REVIEW'||!original.preparation_input?.document)throw Error('EDITORIAL_INPUT_MISSING');
 const document=original.preparation_input.document;
 const evidenceIds=new Set(document.evidence.filter(e=>e.verified===true).map(e=>e.id));
 let rewritten=0;const failures=[];
 for(const destination of original.destinations){
  const current=(await store.adapter.read(campaignId))?.value;
  const previous=current.assets[destination.id];
  if(!isEditorialDestination(destination)||previous?.asset?.kind!=='EMAIL'||current.decisions[destination.id]||current.deliveries[destination.id]||(previous.asset.editorial_reference?.sha256===EDITORIAL_REFERENCE.sha256&&previous.asset.editorial_enforcement===EDITORIAL_ENFORCEMENT_VERSION))continue;
  let asset;try{asset=await write({campaignId,destination,document:{...document,uncertainty:[previous.asset.evidence_limitations,...(document.uncertainty??[])].filter(Boolean)},scan:current.scan});
  }catch(error){
   failures.push({destination_id:destination.id,error:error.message});
   await store.mutate(campaignId,state=>{
    if(state.decisions[destination.id]||state.deliveries[destination.id]||state.assets[destination.id].fingerprint!==previous.fingerprint)return state;
    state.editorial_versions??={};state.editorial_versions[destination.id]??=[];
    state.editorial_versions[destination.id].push(structuredClone(previous));
    const failed={...previous.asset,review_status:'NEEDS_REVISION',delivery_eligible:false,preparation_error:error.message};
    state.assets[destination.id]={asset:failed,fingerprint:assetFingerprint(failed)};return state;
   });
   continue;
  }
  if(asset.campaign_id!==campaignId||asset.destination_id!==destination.id||asset.editorial_reference?.sha256!==EDITORIAL_REFERENCE.sha256)throw Error('EDITORIAL_REFERENCE_REQUIRED');
  verifyEditorialAsset(asset,{evidenceIds});
  // Preserve the reviewed recipient; rewriting words cannot change the addressee.
  asset.to=previous.asset.to;
  const fingerprint=assetFingerprint(asset);
  const saved=await store.mutate(campaignId,state=>{
   if(state.decisions[destination.id]||state.deliveries[destination.id])return state;
   if(state.assets[destination.id].fingerprint!==previous.fingerprint)throw Error('STALE_ASSET_REVISION');
   state.editorial_versions??={};state.editorial_versions[destination.id]??=[];
   state.editorial_versions[destination.id].push(structuredClone(previous));
   state.assets[destination.id]={asset,fingerprint};
   state.events.push({type:'EDITORIAL_STANDARD_REFRESHED',destination_id:destination.id,previous_fingerprint:previous.fingerprint,new_fingerprint:fingerprint,reference_sha256:EDITORIAL_REFERENCE.sha256});
   return state;
  });
  if(saved.assets[destination.id].fingerprint===fingerprint)rewritten++;
 }
 return {campaignId,status:'PUBLICATION_REVIEW',rewritten,failures,reference_sha256:EDITORIAL_REFERENCE.sha256};
}
