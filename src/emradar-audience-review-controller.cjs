'use strict';
// Mount behind the existing review origin at /api/review/audience/* so the
// existing Secure, HttpOnly owner cookie is scoped to these requests. No token
// exchange, notification, upstream mutation, or distribution endpoint exists.
const {createHash}=require('node:crypto');
function createAudienceReviewHandler({audience,origin}={}){
 if(!audience?.view||!audience?.postDecision||!audience?.replyAction)throw Error('AUDIENCE_CONTROLLER_REQUIRED');
 const expected=new URL(origin);if(expected.protocol!=='https:'||expected.origin!==origin)throw Error('AUDIENCE_SECURE_ORIGIN_REQUIRED');
 return async function handler(req,res){
  const reply=(status,data)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(data));};
  try{
   if(req.method!=='POST'||req.headers.origin!==origin)return reply(403,{error:'ACCESS_DENIED'});
   const path=new URL(req.url,origin).pathname;if(!path.startsWith('/api/review/audience/'))return reply(404,{error:'NOT_FOUND'});
   let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>65536)return reply(413,{error:'REQUEST_TOO_LARGE'});}
   const input=JSON.parse(raw||'{}');if(typeof input.campaignId!=='string'||input.campaignId.length>200)return reply(400,{error:'INVALID_REQUEST'});
   const cookies=Object.fromEntries((req.headers.cookie??'').split(';').map(x=>x.trim()).filter(Boolean).map(x=>{const i=x.indexOf('=');return [x.slice(0,i),decodeURIComponent(x.slice(i+1))]}));
   const name='emradar_v3_session_'+createHash('sha256').update(input.campaignId).digest('hex').slice(0,16),value=cookies[name],dot=value?.indexOf('.')??-1;
   if(dot<1||!cookies.emradar_v3_csrf||req.headers['x-emradar-csrf']!==cookies.emradar_v3_csrf)return reply(403,{error:'ACCESS_DENIED'});
   const id=value.slice(0,dot),secret=value.slice(dot+1),campaign=input.campaignId,action=path.slice('/api/review/audience/'.length);
   let result;
   if(action==='view')result=await audience.view(campaign,id,secret);
   else if(action==='thread-present')result=await audience.present(campaign,id,secret,{manifest_sha256:input.manifest_sha256,segment_hashes:input.segment_hashes});
   else if(action==='post-decision')result=await audience.postDecision(campaign,id,secret,input.record_id,input.decision,input.fingerprint,input.asset_sha256);
   else if(action==='reply-action')result=await audience.replyAction(campaign,id,secret,input.discovery_id,input.action_id,input.action,input.asset_sha256,input.text);
   else if(action==='revise'&&input.destinationId==='x')result=await audience.revise(campaign,id,secret,input.fingerprint,input.changes);
   else if(action==='decision'&&input.destinationId==='x')result=await audience.decide(campaign,id,secret,input.decision,input.fingerprint);
   else return reply(404,{error:'NOT_FOUND'});
   // Mutations may return internal state; never expose it through HTTP.
   return reply(200,action==='view'?result:{saved:true});
  }catch(error){return reply(403,{error:/^AUDIENCE_[A-Z0-9_]+$/.test(error.message)?error.message:'ACCESS_DENIED'});}
 };
}
module.exports={createAudienceReviewHandler};
