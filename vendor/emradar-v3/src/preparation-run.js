import {isReviewPhase} from './contracts.js';
import {EVIDENCE_GATE_VERSION,assertGatedDocument} from './claim-evidence-gate.js';
import {createHash,randomUUID} from 'node:crypto';
import {verifyPublishedScan} from './scan-intake.js';
import {CampaignPreparation} from './preparation.js';
import {normalizePublishedEvidence} from './scan-evidence-adapter.js';


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
export function createPreparationRun({store,gateEvidence,discover,write,renderVisual,fetcher}) {
 if(typeof gateEvidence!=='function'||typeof renderVisual!=='function'||typeof store?.mutate!=='function')throw Error('PREPARATION_RUN_DEPENDENCIES_REQUIRED');
 const preparation=new CampaignPreparation({store,discover,write,renderVisual:createVerifiedVisualRenderer(renderVisual)});
 return async ({snapshotDate,expectedSha256,liveUrl,archiveUrl,publicationRecord,releaseAttestation,history=[]})=>{
  const verified=await verifyPublishedScan({snapshotDate,expectedSha256,liveUrl,archiveUrl,publicationRecord,releaseAttestation,fetcher});
  const {scan}=verified;
  const campaignId=await store.start(scan);
  let state=(await store.adapter.read(campaignId)).value;
  if(isReviewPhase(state.phase))return {campaignId,status:'ALREADY_PREPARED'};
  if(state.preparation_input?.document?.evidence_gate?.version!==EVIDENCE_GATE_VERSION){
   // Reserve the existing paid investigation budget before calling a provider.
   // An interrupted or concurrent attempt never silently obtains a fresh budget.
   const attempt=randomUUID();
   state=await store.mutate(campaignId,current=>{
    if(!current.claim_gate_attempt)current.claim_gate_attempt={id:attempt,status:'RUNNING',version:EVIDENCE_GATE_VERSION};
    return current;
   });
   if(state.claim_gate_attempt.id!==attempt)return {campaignId,status:'CLAIM_EVIDENCE_RUN_HELD'};
   const document=assertGatedDocument(await gateEvidence({scan,document:normalizePublishedEvidence(verified.document)}),scan);
   state=await store.mutate(campaignId,current=>{
    if(current.claim_gate_attempt.id!==attempt)throw Error('CLAIM_EVIDENCE_RUN_CHANGED');
    if(current.preparation_input)current.legacy_preparation_input??=current.preparation_input;
    if(current.phase==='DESTINATIONS_SELECTED'){current.legacy_destinations??=current.destinations;current.destinations=[];current.phase='SCAN_VERIFIED';}
    current.preparation_input={document};
    current.claim_gate_attempt={...current.claim_gate_attempt,status:document.evidence.length?'COMPLETE':'NO_VERIFIED_ANGLE'};
    current.events.push({type:'CLAIM_EVIDENCE_GATE_COMPLETED',status:current.claim_gate_attempt.status});
    return current;
   });
  }
  const document=assertGatedDocument(state.preparation_input.document,scan);
  if(!document.evidence.length)return {campaignId,status:'NO_VERIFIED_ANGLE',evidenceGate:document.evidence_gate};
  return preparation.prepare({scan,document,history});
 };
}
