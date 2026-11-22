import {auditCampaignOnce} from './campaign-editorial-shadow.js';

/**
 * Reuse V3's original-source checker as the only evidence authority.
 * Gemini supplies independent objections, NEVER proof or permission to send.
 * One initial campaign review, a bounded V3 correction batch, and at most one
 * final Google review of changed assets. No new worker, gate or database.
 */
export async function reconcileCollaborativeEditorial({
 adapter,campaignId,reviewGoogle,reviewV3,maximumCorrections=6
}){
 if(typeof reviewGoogle!=='function'||typeof reviewV3!=='function')return {status:'NOT_CONFIGURED'};
 const state=(await adapter.read(campaignId))?.value;
 if(!state||!['PUBLICATION_REVIEW','ASSETS_PREPARED'].includes(state.phase))
  return {status:'NO_REVIEW_CAMPAIGN'};
 const initial=await reviewGoogle(state);
 if(initial.status!=='ADVISORY'||!initial.recordKey)
  return {status:'GOOGLE_UNAVAILABLE',google_status:initial.status};
 const receiptKey='v3-collaborative-editorial:'+campaignId+':'+initial.recordKey.split(':').at(-1);
 const priorReceipt=(await adapter.read(receiptKey))?.value;
 if(priorReceipt?.status==='COMPLETE')return {...priorReceipt,status:'ALREADY_RECONCILED'};
 const saved=(await adapter.read(initial.recordKey))?.value;
 if(saved?.status!=='ADVISORY'||!Array.isArray(saved.outcomes))
  return {status:'GOOGLE_UNUSABLE'};
 const requested=saved.outcomes
  .filter(row=>['CORRECT','INVESTIGATE','DROP'].includes(row.verdict))
  .filter(row=>state.assets?.[row.id]?.fingerprint===row.fingerprint)
  .filter(row=>!state.decisions?.[row.id]&&!state.deliveries?.[row.id])
  .sort((a,b)=>({CORRECT:0,INVESTIGATE:1,DROP:2}[a.verdict]-{CORRECT:0,INVESTIGATE:1,DROP:2}[b.verdict]));
 const selected=requested.slice(0,Math.max(0,Math.min(12,maximumCorrections)));
 const results=[];
 for(const row of selected){
  try{
   const current=(await adapter.read(campaignId))?.value;
   if(current?.assets?.[row.id]?.fingerprint!==row.fingerprint||
      current?.decisions?.[row.id]||current?.deliveries?.[row.id]){
    results.push({id:row.id,status:'STALE_OR_PROTECTED'});continue;
   }
   // V3 verifies any Google objections using original source passages.
   // A Google DROP is never an automatic exclusion.
   await reviewV3(campaignId,{ids:[row.id],forceRecheck:true,
    googleFeedback:{[row.id]:{verdict:row.verdict,reason:row.reason,correction:row.correction,sourceUrls:row.sourceUrls}}});
   const revised=(await adapter.read(campaignId))?.value;
   results.push({id:row.id,status:revised?.assets?.[row.id]?.fingerprint!==row.fingerprint?
    'REVISED':'REASSESSED',editorial_status:revised?.editorial_preparation?.outcomes?.[row.id]?.status??'UNRESOLVED'});
  }catch{
   results.push({id:row.id,status:'V3_CORRECTION_UNAVAILABLE'});
  }
 }
 // No new Google call when the actual draft did not change.
 const changed=results.some(row=>row.status==='REVISED');
 let final={status:'UNCHANGED'};
 if(changed){
  try{
   const snapshot=(await adapter.read(campaignId))?.value;
   final=await reviewGoogle(snapshot);
  }catch{final={status:'GOOGLE_UNAVAILABLE'};}
 }
 const outcome={status:'COMPLETE',first_audit:initial.recordKey,
  final_audit:final.recordKey??null,final_status:final.status,
  google_objections:requested.length,corrected:results.filter(r=>r.status==='REVISED').length,
  reassessed:results.filter(r=>r.status==='REASSESSED').length,
  outstanding:requested.length-selected.length,results};
 // Store a lightweight reconciliation receipt separate from proposals/approvals.
 // No mutable campaign state is touched by this advisory receipt.
 await adapter.compareAndSwap(receiptKey,null,{...outcome,at:new Date().toISOString()});
 return outcome;
}
