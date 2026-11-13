import {randomUUID} from 'node:crypto';
import {assetFingerprint,sha256} from './contracts.js';

export const PROPOSAL_VERIFICATION_TTL_MS=7*24*60*60*1000;
export const PROPOSAL_VERIFICATION_STATES=Object.freeze(['VERIFIED','REVISED_AND_VERIFIED','INVESTIGATION_REQUIRED','UNSUPPORTED']);
const cleanArray=value=>Array.isArray(value)?value.filter(item=>item&&typeof item==='object').map(item=>structuredClone(item)):[];
export const evidenceVersion=({asset,evidence=[]})=>sha256(cleanArray(evidence).filter(item=>(asset.evidence_ids??[]).includes(item.id)).map(item=>({id:item.id,sha256:item.sha256??item.page_sha256??null,fact:item.fact??null,source_url:item.source_url??null,updated_at:item.updated_at??null})));
export const proposalBinding=({asset,destination,evidence=[]})=>({asset_sha256:assetFingerprint(asset),campaign_id:asset.campaign_id,destination_id:asset.destination_id,recipient:asset.kind==='EMAIL'?(asset.to??destination?.contact?.email??null):null,destination_sha256:sha256(destination??null),evidence_sha256:evidenceVersion({asset,evidence}),revision_id:asset.revision_id??null});

function normalizedResult(result){
 if(!result||!PROPOSAL_VERIFICATION_STATES.includes(result.status))throw Error('PROPOSAL_VERIFICATION_RESULT_INVALID');
 const claims=cleanArray(result.claims);if(!claims.length)throw Error('PROPOSAL_MATERIAL_CLAIMS_REQUIRED');
 const material=claims.filter(claim=>claim.material!==false);if(material.some(claim=>!claim.id||!claim.text||!['VERIFIED','UNRESOLVED','CONTRADICTED'].includes(claim.status)))throw Error('PROPOSAL_CLAIM_RESULT_INVALID');
 const unresolved=material.filter(claim=>claim.status!=='VERIFIED'),contradictions=cleanArray(result.contradictions);
 if(result.status==='VERIFIED'&&(unresolved.length||contradictions.some(item=>item.material!==false)))throw Error('PROPOSAL_FALSE_VERIFIED');
 if(result.status==='REVISED_AND_VERIFIED'&&(!result.revised_proposal?.body||!unresolved.length))throw Error('PROPOSAL_REVISION_REQUIRED');
 return {status:result.status,claims,contradictions,sources:cleanArray(result.sources),revised_proposal:result.revised_proposal?structuredClone(result.revised_proposal):null,explanation:String(result.explanation??'').trim()||'No verification explanation was returned.',deliverable:result.deliverable===true};
}

export class ProposalVerificationService{
 constructor({investigate,clock=()=>Date.now(),timeoutMs=60_000}){if(typeof investigate!=='function'||!Number.isInteger(timeoutMs)||timeoutMs<1)throw Error('PROPOSAL_VERIFIER_DEPENDENCIES_REQUIRED');this.investigate=investigate;this.clock=clock;this.timeoutMs=timeoutMs;}
 async verify({asset,destination,evidence=[],previous=null}){
  const binding=proposalBinding({asset,destination,evidence}),started=this.clock();let timer;
  try{const raw=await Promise.race([this.investigate({asset:structuredClone(asset),destination:structuredClone(destination),evidence:structuredClone(evidence),previous:structuredClone(previous)}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('PROPOSAL_VERIFICATION_TIMEOUT')),this.timeoutMs);})]);const result=normalizedResult(raw),completed=this.clock();return {id:randomUUID(),...binding,...result,verified_at:new Date(completed).toISOString(),expires_at:new Date(completed+PROPOSAL_VERIFICATION_TTL_MS).toISOString(),attempt_started_at:new Date(started).toISOString()};}
  catch(error){const completed=this.clock(),code=/^[A-Z0-9_]+$/.test(error?.message??'')?error.message:'PROPOSAL_RESEARCH_FAILED';return {id:randomUUID(),...binding,status:'INVESTIGATION_REQUIRED',claims:[],contradictions:[],sources:[],revised_proposal:null,explanation:'Verification did not complete: '+code,deliverable:false,failure_code:code,verified_at:new Date(completed).toISOString(),expires_at:new Date(completed).toISOString(),attempt_started_at:new Date(started).toISOString()};}
  finally{clearTimeout(timer);}
 }
}

export async function replayProposalVerifications({proposals,verify}){if(!Array.isArray(proposals)||typeof verify!=='function')throw Error('HISTORICAL_REPLAY_INPUT_INVALID');const totals={examined:0,passed:0,repaired:0,held:0,failed:0},results=[];for(const proposal of proposals){const result=await verify(proposal);totals.examined++;if(result.status==='VERIFIED')totals.passed++;else if(result.status==='REVISED_AND_VERIFIED')totals.repaired++;else if(result.status==='INVESTIGATION_REQUIRED')totals.held++;else totals.failed++;results.push({proposal_id:proposal.id??proposal.asset?.destination_id,status:result.status,verification_id:result.id});}return {totals,results,non_sending:true};}
