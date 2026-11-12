'use strict';
const crypto=require('node:crypto');
const {checkPersistedRecipient}=require('./emradar-v3-recipient.cjs');
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const digest=value=>crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const equivalent=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));

// Read-only verification of V3 campaign state. No caller-supplied approval
// can authorize SMTP without a matching persisted owner decision and claim.
function createV3ApprovalVerifier({pool}={}){
 if(typeof pool?.query!=='function')throw Error('V3_POSTGRES_POOL_REQUIRED');
 return async request=>{
  const {asset,approval,idempotency_key,campaign_id,destination_id}=request||{};
  if(!asset||!approval||approval.authority!=='OWNER'||approval.decision!=='APPROVE'||!['EMAIL','X'].includes(asset.kind)||asset.campaign_id!==campaign_id||asset.destination_id!==destination_id||approval.campaign_id!==campaign_id||approval.destination_id!==destination_id)throw Error('V3_OWNER_APPROVAL_REQUIRED');
  if(!/^[a-f0-9]{64}$/.test(idempotency_key||'')||!/^[a-f0-9]{64}$/.test(approval.asset_sha256||''))throw Error('V3_DELIVERY_CLAIM_INVALID');
  const {rows}=await pool.query('SELECT payload FROM v3_campaign_state WHERE campaign_id=$1',[campaign_id]);
  const state=rows[0]?.payload;
  const saved=state?.assets?.[destination_id],decision=state?.decisions?.[destination_id],delivery=state?.deliveries?.[destination_id];
  if(state?.phase!=='PUBLICATION_REVIEW'||!saved||!decision||!delivery)throw Error('V3_DURABLE_APPROVAL_REQUIRED');
  if(!equivalent(saved.asset,asset)||saved.fingerprint!==approval.asset_sha256||digest(asset)!==approval.asset_sha256||!equivalent(decision,approval))throw Error('V3_DURABLE_APPROVAL_MISMATCH');
  const verification=state?.proposal_verifications?.[destination_id]?.at?.(-1),destination=state?.destinations?.find(item=>item.id===destination_id),evidence=state?.preparation_input?.document?.evidence??[];
  const evidenceDigest=digest(evidence.filter(item=>(asset.evidence_ids??[]).includes(item.id)).map(item=>({id:item.id,sha256:item.sha256??item.page_sha256??null,fact:item.fact??null,source_url:item.source_url??null,updated_at:item.updated_at??null})));
  if(!verification||verification.status!=='VERIFIED'||verification.deliverable!==true||approval.proposal_verification_id!==verification.id)throw Error('V3_PROPOSAL_VERIFICATION_REQUIRED');
  if(verification.asset_sha256!==approval.asset_sha256||verification.campaign_id!==campaign_id||verification.destination_id!==destination_id||verification.recipient!==(asset.kind==='EMAIL'?(asset.to??destination?.contact?.email??null):null)||verification.destination_sha256!==digest(destination??null)||verification.evidence_sha256!==evidenceDigest||verification.revision_id!==(asset.revision_id??null)||!Date.parse(verification.verified_at)||Date.parse(verification.expires_at)<=Date.now())throw Error('V3_PROPOSAL_VERIFICATION_STALE');
  if((verification.claims??[]).some(claim=>claim.material!==false&&claim.status!=='VERIFIED')||(verification.contradictions??[]).some(item=>item.material!==false))throw Error('V3_PROPOSAL_UNSUPPORTED');
  if(digest([campaign_id,destination_id,approval.asset_sha256])!==idempotency_key||delivery.status!=='ATTEMPTING'||delivery.idempotency_key!==idempotency_key)throw Error('V3_DURABLE_CLAIM_REQUIRED');
  if(asset.kind==='EMAIL')await checkPersistedRecipient(pool,asset,state);
  else require('./emradar-v3-x.cjs').graphic(asset);
  return true;
 };
}
module.exports={createV3ApprovalVerifier};
