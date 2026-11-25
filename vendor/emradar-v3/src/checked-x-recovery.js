import {attributeX} from './x-attribution.js';
import {randomUUID} from 'node:crypto';
import {proposalBinding} from './proposal-verification.js';
import {editorialStatus, isEditorialReady} from './editorial-preparation.js';

// Reuse only exact, previously assessed claims with saved source-page receipts.
export async function recoverCheckedX({store,campaignId,renderRevision}){
 const state=(await store.adapter.read(campaignId))?.value;
 const entry=state?.assets?.x, document=state?.preparation_input?.document;
 if(!entry || !document || state.phase!=='PUBLICATION_REVIEW' || state.deliveries?.x ||
    state.decisions?.x || state.review_actions?.x || isEditorialReady(editorialStatus(state,'x')) ||
    state.events.some(event=>event.destination_id==='x' && event.changed_fields))return false;
 const dest=id=>state.destinations.find(item=>item.id===id);
 const bind=asset=>proposalBinding({asset,destination:dest(asset.destination_id),evidence:document.evidence});
 const candidates=[entry,...Object.values(state.assets).filter(item=>item!==entry)];
 for(const candidate of candidates){
  const original=candidate.asset, outcome=state.editorial_preparation?.outcomes?.[original.destination_id];
  if(!outcome || Object.entries(bind(original)).some(([k,v])=>outcome[k]!==v))continue;
  const record=document.records?.find(item=>item.id===original.story_record_id);
  if(!record || outcome.claims?.some(item=>item.status==='CONTRADICTED'))continue;
  const evidence=document.evidence.filter(item=>item.verified===true && item.record_id===record.id && original.evidence_ids?.includes(item.id));
  const eligibleSources=(outcome.sources??[]).filter(source=>/^[0-9a-f]{64}$/.test(source.page_sha256) &&
    source.quote?.trim().length>=24 && evidence.some(item=>item.source_url===source.url));
  const claims=(outcome.claims??[]).filter(claim=>claim.material!==false && claim.status==='VERIFIED' &&
   typeof claim.text==='string' && claim.text.trim().length>=16 && claim.text.length<=450 &&
   !/\b(?:proposal|article offers|draft|readership|recipient|we (?:can|could|will)|this pitch)\b/i.test(claim.text) &&
   claim.passages?.length && claim.passages.every(p=>eligibleSources.some(s=>s.url===p.url && s.quote===p.quote))).slice(0,3);
  if(!claims.length)continue;
  const sources=eligibleSources.filter(s=>claims.some(c=>c.passages.some(p=>s.url===p.url && s.quote===p.quote)));
  const ids=evidence.filter(item=>sources.some(s=>s.url===item.source_url)).map(item=>item.id);
  const paragraphs=[...new Set(claims.map(c=>c.text.trim()))];
  const links=[...new Set(sources.map(s=>s.url))];
  const asset={...entry.asset,kind:'X',subject:paragraphs[0],body:attributeX([[record.location,record.status].filter(Boolean).join(' · '),paragraphs.join(' '),...links].filter(Boolean).join('\n\n'),record,evidence),
   story_record_id:record.id,evidence_ids:ids,review_status:'READY',analytical_finding:paragraphs.at(-1),
   evidence_limitations:record.missing_evidence??[],editorial_source_grounded:true};
  delete asset.preparation_error;
  // Keep the featured formation on the card even if it was sixth in the scan.
  const ordered={...document,records:[record,...document.records.filter(r=>r.id!==record.id)]};
  let revised;
  try{revised=await renderRevision(asset,{...state,preparation_input:{document:ordered}});}
  catch(error){
   if(error.message!=='V3_X_VALID_FORMATION_TITLE_REQUIRED')throw error;
   try{revised=await renderRevision(asset,{...state,preparation_input:{document:{...ordered,records:[record]}}});}
   catch(singleError){if(singleError.message==='V3_X_VALID_FORMATION_TITLE_REQUIRED')continue;throw singleError;}
  }
  if(revised.visual_mime!=='image/png'||!revised.visual_base64||!revised.visual_sha256)throw Error('X_RECOVERY_PNG_REQUIRED');
  const result=await store.applyEditorialPreparation(campaignId,[{id:'x',fingerprint:entry.fingerprint,
   inputBinding:bind(entry.asset),asset:revised,preserveOwner:true,record:{id:randomUUID(),...bind(revised),
    status:'CORRECTED_READY',reason:'This version uses only claims previously checked against the linked source passages.',
    claims,sources,reused_outcome_id:outcome.id,checked_at:new Date().toISOString()}}]);
  return result?.assets?.x?.fingerprint===bind(revised).asset_sha256;
 }
 return false;
}
