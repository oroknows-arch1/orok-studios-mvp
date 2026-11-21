'use strict';
const crypto=require('node:crypto');
const digest=value=>crypto.createHash('sha256').update(value).digest('hex');

// Verifies the owner link against V3's durable review record, not caller input.
// The review record is stored under review:<campaignId> in v3_campaign_state.
function createV3NotificationVerifier({pool,reviewOrigin,clock=()=>Date.now()}={}){
 if(typeof reviewOrigin!=='string')throw Error('V3_REVIEW_ORIGIN_REQUIRED');
 let allowed;
 try{allowed=new URL(reviewOrigin);}catch{throw Error('V3_REVIEW_ORIGIN_REQUIRED');}
 if(allowed.protocol!=='https:'||allowed.username||allowed.password||allowed.search||allowed.hash||allowed.pathname!=='/')throw Error('V3_REVIEW_ORIGIN_REQUIRED');
 if(typeof pool?.query!=='function')throw Error('V3_POSTGRES_POOL_REQUIRED');
 return async request=>{
  const id=request?.campaign_id,raw=request?.private_review_url;
  if(request?.to!=='sean@emradar.net'||typeof id!=='string'||!id.startsWith('v3-')||typeof raw!=='string')throw Error('V3_NOTIFICATION_INVALID');
  let url;
  try{url=new URL(raw);}catch{throw Error('V3_PRIVATE_LINK_REQUIRED');}
  if(url.origin!==allowed.origin||url.protocol!=='https:'||url.username||url.password||url.search||url.pathname!=='/review/access')throw Error('V3_PRIVATE_LINK_REQUIRED');
  const params=new URLSearchParams(url.hash.slice(1));
  const token=params.get('token');
  if(params.size!==2||!token||params.get('campaign')!==id)throw Error('V3_PRIVATE_LINK_REQUIRED');
  const {rows}=await pool.query('SELECT campaign_id,payload FROM v3_campaign_state WHERE campaign_id=ANY($1::text[])',[[id,'review:'+id]]);
  const records=new Map(rows.map(row=>[row.campaign_id,row.payload]));
  const campaign=records.get(id),review=records.get('review:'+id);
  if(campaign?.phase!=='PUBLICATION_REVIEW'||review?.campaign_id!==id||!['ISSUED','NOTIFICATION_AMBIGUOUS'].includes(review.status)||review.consumed_at!==null||!Number.isFinite(review.expires_at)||clock()>=review.expires_at)throw Error('V3_DURABLE_NOTIFICATION_REQUIRED');
  const a=Buffer.from(review.token_hash||'','hex'),b=Buffer.from(digest(token),'hex');
  if(a.length!==32||!crypto.timingSafeEqual(a,b))throw Error('V3_PRIVATE_LINK_MISMATCH');
  return true;
 };
}
module.exports={createV3NotificationVerifier};
