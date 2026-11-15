import {randomUUID} from 'node:crypto';
import {proposalBinding} from './proposal-verification.js';
import {sha256} from './contracts.js';

const exactContentKey=asset=>sha256({kind:asset.kind,subject:asset.subject??null,body:asset.body,evidence_ids:[...(asset.evidence_ids??[])].sort()});
const validVerified=(record,binding,now)=>record?.status==='VERIFIED'&&record.deliverable===true&&Array.isArray(record.claims)&&record.claims.length>0&&record.claims.every(claim=>claim.material===false||claim.status==='VERIFIED')&&Date.parse(record.expires_at)>now&&Object.keys(binding).every(key=>record[key]===binding[key]);
const heldRecord=({asset,destination,evidence,clock,code,explanation,source=null})=>{
 const at=new Date(clock()).toISOString();
 return {id:randomUUID(),...proposalBinding({asset,destination,evidence}),status:'INVESTIGATION_REQUIRED',claims:[],contradictions:[],sources:[],revised_proposal:null,explanation,deliverable:false,failure_code:code,verified_at:at,expires_at:at,attempt_started_at:at,automatic:true,...(source?{related_verification_id:source.id}: {})};
};

export async function automaticallyVerifyProposals({store,campaignId,verifier,maxInvestigations=8,clock=()=>Date.now()}){
 if(!store?.adapter?.read||typeof store.recordProposalVerification!=='function'||typeof store.recordAutomaticVerificationRun!=='function'||typeof verifier?.verify!=='function'||!Number.isInteger(maxInvestigations)||maxInvestigations<1)throw Error('AUTOMATIC_PROPOSAL_VERIFICATION_DEPENDENCIES_REQUIRED');
 const state=(await store.adapter.read(campaignId))?.value;
 if(!state?.assets||!state?.preparation_input?.document)throw Error('AUTOMATIC_PROPOSAL_VERIFICATION_STATE_REQUIRED');
 const assetsDigest=sha256(Object.entries(state.assets).sort(([a],[b])=>a.localeCompare(b)).map(([id,entry])=>[id,entry.fingerprint]));
 if(state.automatic_proposal_verification?.assets_digest===assetsDigest)return structuredClone(state.automatic_proposal_verification);
 const evidence=state.preparation_input.document.evidence??[],groups=new Map();
 for(const [destinationId,entry] of Object.entries(state.assets)){
  const key=exactContentKey(entry.asset);if(!groups.has(key))groups.set(key,[]);groups.get(key).push({destinationId,entry});
 }
 const summary={status:'COMPLETE',assets_digest:assetsDigest,started_at:new Date(clock()).toISOString(),distinct_proposals:groups.size,total_proposals:Object.keys(state.assets).length,max_investigations:maxInvestigations,investigations_used:0,reused_successes:0,verified:0,investigation_required:0,unsupported:0,budget_held:0};
 for(const members of groups.values()){
  let source=null;
  for(const {destinationId,entry} of members){
   const destination=state.destinations.find(item=>item.id===destinationId),binding=proposalBinding({asset:entry.asset,destination,evidence});
   const current=state.proposal_verifications?.[destinationId]?.at(-1);
   if(validVerified(current,binding,clock())){source=current;summary.verified++;break;}
  }
  if(!source&&summary.investigations_used<maxInvestigations){
   const {destinationId,entry}=members[0],destination=state.destinations.find(item=>item.id===destinationId);
   source=await verifier.verify({asset:entry.asset,destination,evidence,previous:state.proposal_verifications?.[destinationId]?.at(-1)??null});
   source={...source,automatic:true,review_scope:'AUTOMATIC_DISTINCT_PROPOSAL'};
   await store.recordProposalVerification(campaignId,destinationId,entry.fingerprint,source);summary.investigations_used++;
   if(source.status==='VERIFIED')summary.verified++;else if(source.status==='UNSUPPORTED')summary.unsupported++;else summary.investigation_required++;
  }
  if(!source){
   summary.status='PARTIAL_BUDGET_LIMIT';
   for(const {destinationId,entry} of members){
    const destination=state.destinations.find(item=>item.id===destinationId),held=heldRecord({asset:entry.asset,destination,evidence,clock,code:'AUTOMATIC_VERIFICATION_BUDGET_EXHAUSTED',explanation:'Automatic verification was held because the campaign investigation limit was reached.'});
    await store.recordProposalVerification(campaignId,destinationId,entry.fingerprint,held);summary.investigation_required++;summary.budget_held++;
   }
   continue;
  }
  for(const {destinationId,entry} of members){
   if(destinationId===source.destination_id)continue;
   const destination=state.destinations.find(item=>item.id===destinationId),binding=proposalBinding({asset:entry.asset,destination,evidence});
   const current=state.proposal_verifications?.[destinationId]?.at(-1);
   if(validVerified(current,binding,clock()))continue;
   if(source.status==='VERIFIED'&&source.deliverable===true){
    const reused={...structuredClone(source),...binding,id:randomUUID(),automatic:true,reused_from_verification_id:source.id,review_scope:'SHARED_EXACT_CONTENT'};
    await store.recordProposalVerification(campaignId,destinationId,entry.fingerprint,reused);summary.verified++;summary.reused_successes++;
   }else{
    const held=heldRecord({asset:entry.asset,destination,evidence,clock,code:'IDENTICAL_PROPOSAL_NOT_VERIFIED',explanation:'The automatic check for this identical proposal did not produce reusable verified evidence.',source});
    await store.recordProposalVerification(campaignId,destinationId,entry.fingerprint,held);summary.investigation_required++;
   }
  }
 }
 summary.completed_at=new Date(clock()).toISOString();
 await store.recordAutomaticVerificationRun(campaignId,summary);
 return summary;
}
