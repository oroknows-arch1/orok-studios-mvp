import restartPolicy from '../../../src/emradar-v3-clean-restart.cjs';
import {isReviewPhase} from './contracts.js';
import {createHash,randomUUID} from 'node:crypto';
import {verifyPublishedScan} from './scan-intake.js';
import {CampaignPreparation} from './preparation.js';
import {normalizePublishedEvidence} from './scan-evidence-adapter.js';
import claimPolicy from '../../emradar-v3-authoritative/src/claim-evidence.cjs';
const {hasCheckedDocument,assertCheckedDocument}=claimPolicy;


export function createVerifiedVisualRenderer(renderVisual){
 return async input=>{
  const visual=await renderVisual(input);
  const bytes=visual?.bytes instanceof Uint8Array?Buffer.from(visual.bytes):typeof visual?.base64==='string'?Buffer.from(visual.base64,'base64'):null;
  if(!bytes?.length) throw Error('X_VISUAL_BYTES_REQUIRED');
  const png=bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')) && bytes.length>=45 && bytes.toString('ascii',12,16)==='IHDR' && bytes.readUInt32BE(16)>0 && bytes.readUInt32BE(20)>0 && bytes.toString('ascii',bytes.length-8,bytes.length-4)==='IEND';
  const jpeg=bytes.length>4 && bytes[0]===255 && bytes[1]===216 && bytes[bytes.length-2]===255 && bytes[bytes.length-1]===217;
  if(!png && !jpeg) throw Error('X_VISUAL_IMAGE_REQUIRED');
  const sha256=createHash('sha256').update(bytes).digest('hex');
  if(visual.sha256 && visual.sha256!==sha256) throw Error('X_VISUAL_DIGEST_MISMATCH');
  input.asset.visual_base64=bytes.toString('base64');
  input.asset.visual_mime=png?'image/png':'image/jpeg';
  if(visual.brand_version)input.asset.visual_brand_version=visual.brand_version;
  if(visual.diagnostics)input.asset.visual_diagnostics=structuredClone(visual.diagnostics);
  return {sha256,url:'data:'+input.asset.visual_mime+';base64,'+input.asset.visual_base64,diagnostics:visual.diagnostics};
 };
}

// Compose existing preparation workers. Providers are injected; this entry point
// never issues a review notification, approves content or distributes anything.
export function createPreparationRun({store,verifyClaims,discover,write,renderVisual,fetcher}) {
 if(typeof verifyClaims!=='function' || typeof renderVisual!=='function' || typeof store?.mutate!=='function') throw Error('PREPARATION_RUN_DEPENDENCIES_REQUIRED');
 const preparation=new CampaignPreparation({store,discover,write,renderVisual:createVerifiedVisualRenderer(renderVisual)});
 return async ({snapshotDate,expectedSha256,liveUrl,archiveUrl,publicationRecord,releaseAttestation,restartKey,history=[]})=>{
  const verified=await verifyPublishedScan({snapshotDate,expectedSha256,liveUrl,archiveUrl,publicationRecord,releaseAttestation,fetcher});
  const {scan}=verified;
  const document=normalizePublishedEvidence(verified.document);
  const campaignId=await store.start(scan,{restartKey});
  let state=(await store.adapter.read(campaignId)).value;
  if(isReviewPhase(state.phase)) return {campaignId,status:'ALREADY_PREPARED'};
  const reuseResearch=state.claim_gate_attempt?.status==='VERIFIED'&&hasCheckedDocument(state.preparation_input?.document,scan);
  const recoveryIds=current=>restartPolicy.recoverableRecords(current,restartKey)?.length?restartPolicy.recoverableRecords(current,restartKey):restartPolicy.recoverableSourceRecords(current);
  const recoverRecordIds=hasCheckedDocument(state.preparation_input?.document,scan)?recoveryIds(state):null;
  if(recoverRecordIds?.length||!hasCheckedDocument(state.preparation_input?.document,scan)){
   const attempt=randomUUID();
   state=await store.mutate(campaignId,current=>{
    if(recoverRecordIds?.length&&JSON.stringify(recoveryIds(current))===JSON.stringify(recoverRecordIds)){
     current.claim_gate_history=[...(current.claim_gate_history??[]),{attempt:current.claim_gate_attempt,document:current.preparation_input.document}].slice(-3);
     current.claim_gate_previous={attempt:current.claim_gate_attempt,document:current.preparation_input.document};
     const previousRevision=current.claim_gate_attempt?.policy_revision;
     const policyRevision=previousRevision==='passage-selection-v6'?'question-completion-v7':previousRevision==='partial-claim-v5'?'passage-selection-v6':previousRevision==='exact-figure-v4'?'partial-claim-v5':previousRevision==='credit-restored-v3'?'exact-figure-v4':previousRevision==='provider-diagnostics-v2'?'credit-restored-v3':'provider-diagnostics-v2';
     current.claim_gate_attempt={id:attempt,status:'RUNNING',source_reader_revision:restartPolicy.sourceReaderRevision,policy_revision:policyRevision,recovery_record_ids:recoverRecordIds};
    }else if(!current.claim_gate_attempt)current.claim_gate_attempt={id:attempt,status:'RUNNING',source_reader_revision:restartPolicy.sourceReaderRevision};
    return current;
   });
   if(state.claim_gate_attempt?.id!==attempt)return {campaignId,status:'CLAIM_EVIDENCE_HELD'};
   const checked=await verifyClaims({scan,document,recoverRecordIds});
   assertCheckedDocument(checked,scan);
   state=await store.mutate(campaignId,current=>{
    current.preparation_input={document:checked};
    current.claim_gate_attempt={...current.claim_gate_attempt,status:checked.evidence.length?'VERIFIED':'NO_VERIFIED_ANGLE'};
    // Resume pre-upgrade interrupted preparation from the checked dossier.
    if(current.phase==='DESTINATIONS_SELECTED'){current.phase='SCAN_VERIFIED';current.destinations=[];}
    return current;
   });
  }
  if(!state.preparation_input.document.evidence.length)return {campaignId,status:'CLAIM_EVIDENCE_HELD'};
  return preparation.prepare({scan,restartKey,document:state.preparation_input.document,history,reuseResearch});
 };
}
