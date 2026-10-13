'use strict';
const crypto=require('node:crypto');
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const digest=value=>crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const equivalent=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));

// Read-only verification of V3 campaign state. No caller-supplied approval
// can authorize SMTP without a matching persisted owner decision and claim.
function createV3ApprovalVerifier({pool}={}){
 if(typeof pool?.query!=='function')throw Error('V3_POSTGRES_POOL_REQUIRED');
 return async request=>{
  const {asset,approval,idempotency_key,campaign_id,destination_id}=request||{};
  if(!asset||!approval||approval.authority!=='OWNER'||approval.decision!=='APPROVE'||asset.kind!=='EMAIL'||asset.campaign_id!==campaign_id||asset.destination_id!==destination_id||approval.campaign_id!==campaign_id||approval.destination_id!==destination_id)throw Error('V3_OWNER_APPROVAL_REQUIRED');
  if(!/^[a-f0-9]{64}$/.test(idempotency_key||'')||!/^[a-f0-9]{64}$/.test(approval.asset_sha256||''))throw Error('V3_DELIVERY_CLAIM_INVALID');
  const {rows}=await pool.query('SELECT payload FROM v3_campaign_state WHERE campaign_id=$1',[campaign_id]);
  const state=rows[0]?.payload;
  const saved=state?.assets?.[destination_id],decision=state?.decisions?.[destination_id],delivery=state?.deliveries?.[destination_id];
  if(state?.phase!=='PUBLICATION_REVIEW'||!saved||!decision||!delivery)throw Error('V3_DURABLE_APPROVAL_REQUIRED');
  if(!equivalent(saved.asset,asset)||saved.fingerprint!==approval.asset_sha256||digest(asset)!==approval.asset_sha256||!equivalent(decision,approval))throw Error('V3_DURABLE_APPROVAL_MISMATCH');
  if(digest([campaign_id,destination_id,approval.asset_sha256])!==idempotency_key||delivery.status!=='ATTEMPTING'||delivery.idempotency_key!==idempotency_key)throw Error('V3_DURABLE_CLAIM_REQUIRED');
  return true;
 };
}
module.exports={createV3ApprovalVerifier};
