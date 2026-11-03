'use strict';
// Dependency-injected X API v2 transport. No credentials or network at import time.
function createXThreadTransport({fetchImpl,accessToken,baseUrl='https://api.x.com',timeoutMs=15000}={}){
 if(typeof fetchImpl!=='function'||typeof accessToken!=='string'||!accessToken.trim())throw Error('X_THREAD_TRANSPORT_CONFIG_REQUIRED');
 if(baseUrl!=='https://api.x.com'&&baseUrl!=='https://api.twitter.com')throw Error('X_THREAD_TRANSPORT_ORIGIN_INVALID');
 if(!Number.isInteger(timeoutMs)||timeoutMs<1000||timeoutMs>60000)throw Error('X_THREAD_TIMEOUT_INVALID');
 return async function publishPost({text,parent_receipt_id,media}={}){
  if(typeof text!=='string'||!text.trim())throw Error('X_THREAD_TEXT_REQUIRED');
  if(parent_receipt_id!=null&&!/^\d+$/.test(String(parent_receipt_id)))throw Error('X_THREAD_PARENT_INVALID');
  // Media upload is outside this adapter: only confirmed, previously uploaded IDs.
  const ids=media?.media_ids;
  if(media!=null&&(!Array.isArray(ids)||!ids.length||ids.length>4||ids.some(x=>!/^\d+$/.test(String(x)))))throw Error('X_THREAD_MEDIA_INVALID');
  const payload={text};
  if(parent_receipt_id!=null)payload.reply={in_reply_to_tweet_id:String(parent_receipt_id)};
  if(ids)payload.media={media_ids:ids.map(String)};
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
   const response=await fetchImpl(baseUrl+'/2/tweets',{method:'POST',headers:{authorization:'Bearer '+accessToken,'content-type':'application/json'},body:JSON.stringify(payload),signal:controller.signal});
   if(!response?.ok)throw Error('X_THREAD_SUBMISSION_UNCONFIRMED');
   const data=await response.json();
   if(!/^\d+$/.test(String(data?.data?.id||'')))throw Error('X_THREAD_RECEIPT_MISSING');
   return {accepted:true,receipt_id:String(data.data.id)};
  }finally{clearTimeout(timer);}
 };
}
module.exports={createXThreadTransport};
