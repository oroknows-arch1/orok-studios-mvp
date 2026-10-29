'use strict';
// Adapted from emradar-marketing/server.js and runtime/x-authorization.js.
// Native PostgreSQL authentication; no legacy token or service dependency.
// No connection, renewal or publication occurs at construction.
const {createHash}=require('node:crypto');
const {createV3XAuth,assertScopes}=require('./emradar-v3-x-auth.cjs');
const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=code=>{throw Error('V3_X_'+code);};

function graphic(asset){
 if(asset?.kind!=='X'||asset.destination_id!=='x'||typeof asset.body!=='string'||!asset.body.trim())fail('ASSET_INVALID');
 const encoded=asset.visual_base64 || /^data:image\/(?:png|jpeg);base64,(.+)$/.exec(asset.visual_url||'')?.[1];
 if(typeof encoded!=='string'||encoded.length>7*1024*1024||!encoded.length||!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))fail('GRAPHIC_REQUIRED');
 const bytes=Buffer.from(encoded,'base64');
 if(bytes.toString('base64')!==encoded||bytes.length>5*1024*1024||hash(bytes)!==asset.visual_sha256)fail('GRAPHIC_DIGEST_MISMATCH');
 const png=bytes.length>=45&&bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))&&bytes.toString('ascii',12,16)==='IHDR'&&bytes.readUInt32BE(16)>0&&bytes.readUInt32BE(20)>0&&bytes.toString('ascii',bytes.length-8,bytes.length-4)==='IEND';
 const jpeg=bytes.length>4&&bytes[0]===255&&bytes[1]===216&&bytes[bytes.length-2]===255&&bytes[bytes.length-1]===217;
 const mime=png?'image/png':jpeg?'image/jpeg':null;
 if(!mime||(asset.visual_mime&&asset.visual_mime!==mime))fail('GRAPHIC_FORMAT_INVALID');
 return {bytes,mime};
}

function createV3X({env={},pool,fetcher=fetch,auth:injectedAuth,clock=()=>Date.now(),sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}){
 const authService=injectedAuth||createV3XAuth({env,pool,fetcher,clock});
 function assertEnabled(){if(env.EMRADAR_V3_X_PUBLISH_ENABLED!=='true')fail('PUBLISH_DISABLED');}
 async function request(path,token,options={}){
  let response;try{response=await fetcher('https://api.x.com'+path,{...options,redirect:'error',signal:AbortSignal.timeout(20000),headers:{authorization:'Bearer '+token,...options.headers}});}catch{fail('NETWORK_OUTCOME_UNKNOWN');}
  const data=await response.json().catch(()=>null);
  if(!response.ok)fail('HTTP_'+response.status);
  if(!data&&response.status!==204)fail('RESPONSE_INVALID');
  if(data?.errors?.length)fail('RESPONSE_ERRORS');
  return data||{};
 }
 const current=input=>authService.current(input);
 const identity=auth=>authService.verifyAccount(auth);
 async function reconcile(asset,scan,auth,accountId){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(scan?.snapshot_date||''))fail('SCAN_DATE_REQUIRED');
  // Start a day early to cover the published scan's Sydney/UTC boundary.
  const startTime=new Date(Date.parse(scan.snapshot_date+'T00:00:00Z')-86400000).toISOString();
  let next,pages=0;
  do{
   const query=new URLSearchParams({max_results:'100',start_time:startTime,'tweet.fields':'created_at,note_tweet,entities'});
   if(next)query.set('pagination_token',next);
   const result=await request('/2/users/'+accountId+'/tweets?'+query,auth.access_token);
   if(!result.meta||!Number.isInteger(result.meta.result_count)||result.meta.result_count<0||!Array.isArray(result.data??[])||(result.data??[]).length!==result.meta.result_count)fail('HISTORY_UNKNOWN');
   for(const post of result.data??[]){
    let text=post.note_tweet?.text??post.text;
    if(typeof text!=='string'||(!post.note_tweet&&/…$/.test(text)))fail('HISTORY_INCOMPLETE');
    for(const url of (post.note_tweet?.entities??post.entities)?.urls??[])text=text.replaceAll(url.url,url.expanded_url||url.url);
    if(text===asset.body)fail('ALREADY_PUBLISHED');
   }
   pages++;next=result.meta.next_token;
  }while(next&&pages<5);
  if(next)fail('HISTORY_INCOMPLETE');
  return {status:'VERIFIED_NOT_PUBLISHED',account_id:accountId,start_time:startTime,checked_at:new Date(clock()).toISOString(),pages};
 }
 async function prepare({asset,scan,threadPost=false,parent_receipt_id=null}){
  assertEnabled();
  asset=structuredClone(asset);
  if(threadPost&&!require('./emradar-x-thread-text.cjs').validText(asset?.body))fail('THREAD_TEXT_INVALID');
  if(parent_receipt_id!==null&&!/^\d+$/.test(String(parent_receipt_id)))fail('THREAD_PARENT_INVALID');
  const image=threadPost&&!asset.visual_base64?null:graphic(asset);
  const {bytes,mime}=image??{};
  const auth=await current({allowRefresh:true});
  assertScopes(auth);
  const account=await identity(auth);
  const reconciliation=await reconcile(asset,scan,auth,account.account_id);
  return {asset_sha256:hash(JSON.stringify(canonical(asset))),publish:async({onMediaUploaded}={})=>{
   assertEnabled();
   let id=null,mediaKey=null;
   if(image){
   const init=await request('/2/media/upload/initialize',auth.access_token,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({media_type:mime,total_bytes:bytes.length,media_category:'tweet_image'})});
   id=String(init.data?.id||init.data?.media_id||init.media_id_string||'');mediaKey=init.data?.media_key??null;
   if(!/^\d{1,19}$/.test(id))fail('MEDIA_RECEIPT_REQUIRED');
   const append=new FormData();append.set('segment_index','0');append.set('media',new Blob([bytes],{type:mime}),'approved-graphic');
   await request('/2/media/upload/'+id+'/append',auth.access_token,{method:'POST',body:append});
   const final=await request('/2/media/upload/'+id+'/finalize',auth.access_token,{method:'POST'});
   let info=final.data?.processing_info??final.processing_info,polls=0,waited=0;
   while(info&&info.state!=='succeeded'){
    if(info.state==='failed')fail('MEDIA_PROCESSING_FAILED');
    if(!['pending','in_progress'].includes(info.state)||polls++>=5)fail('MEDIA_PROCESSING_INCOMPLETE');
    const seconds=Number(info.check_after_secs??1);
    if(!Number.isFinite(seconds)||seconds<0||seconds>10||waited+seconds>30)fail('MEDIA_PROCESSING_INCOMPLETE');
    waited+=seconds;await sleep(seconds*1000);
    const status=await request('/2/media/upload?command=STATUS&media_id='+id,auth.access_token);
    info=status.data?.processing_info??status.processing_info;
    if(!info)fail('MEDIA_PROCESSING_INCOMPLETE');
   }
   if(onMediaUploaded)await onMediaUploaded({media_id:id,media_key:mediaKey,visual_sha256:asset.visual_sha256,account_id:account.account_id});
   }
   const payload={text:asset.body};if(id)payload.media={media_ids:[id]};if(parent_receipt_id!==null)payload.reply={in_reply_to_tweet_id:String(parent_receipt_id)};
   const post=await request('/2/tweets',auth.access_token,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
   if(!/^\d+$/.test(post.data?.id||''))fail('POST_RECEIPT_REQUIRED');
   return {accepted:true,receipt_id:post.data.id,post_url:'https://x.com/i/web/status/'+post.data.id,account_id:account.account_id,media_id:id,media_key:mediaKey,visual_sha256:asset.visual_sha256,reconciliation};
  }};
 }
 return {assertEnabled,prepare,auth:authService,
  prepareThreadPost:({segment,scan,parent_receipt_id=null})=>prepare({scan,parent_receipt_id,threadPost:true,asset:{kind:'X',destination_id:'x',body:segment.text,...(segment.media?{visual_base64:segment.media.base64,visual_mime:segment.media.mime,visual_sha256:segment.media.sha256}:{})}}),
  reconcileThreadPost:async({segment,scan,parent_receipt_id,upload})=>{
   const auth=await current({allowRefresh:true});assertScopes(auth);const account=await identity(auth);
   if(segment.media&&(!upload?.media_key||upload.visual_sha256!==segment.media.sha256||upload.account_id!==account.account_id))return {status:'UNRESOLVED'};
   let next;const matches=[];
   for(let page=0;page<5;page++){
    const query=new URLSearchParams({max_results:'100',start_time:new Date(Date.parse(scan.snapshot_date+'T00:00:00Z')-86400000).toISOString(),'tweet.fields':'created_at,note_tweet,entities,referenced_tweets,attachments'});if(next)query.set('pagination_token',next);
    const result=await request('/2/users/'+account.account_id+'/tweets?'+query,auth.access_token);
    if(!result.meta||!Array.isArray(result.data??[])||result.meta.result_count!==(result.data??[]).length)return {status:'UNRESOLVED'};
    for(const post of result.data??[]){
     let text=post.note_tweet?.text??post.text;if(typeof text!=='string'||(!post.note_tweet&&/…$/.test(text)))return {status:'UNRESOLVED'};
     for(const url of (post.note_tweet?.entities??post.entities)?.urls??[])text=text.replaceAll(url.url,url.expanded_url||url.url);
     const parent=post.referenced_tweets?.find(r=>r.type==='replied_to')?.id??null;
     const media=post.attachments?.media_keys??[];
     if(text===segment.text&&parent===parent_receipt_id&&JSON.stringify(media)===JSON.stringify(segment.media?[upload.media_key]:[]))matches.push(post);
    }
    next=result.meta.next_token;if(!next)break;
   }
   if(next||matches.length!==1)return {status:'UNRESOLVED'};
   return {status:'VERIFIED_ACCEPTED',receipt_id:matches[0].id,account_id:account.account_id,created_at:matches[0].created_at};
  },
  verifyIdentity:async({allowRefresh=false}={})=>identity(await current({allowRefresh})),
  inspect:async({asset,scan})=>{
   graphic(asset);const auth=await current();assertScopes(auth);const account=await identity(auth);
   return {...account,visual_sha256:asset.visual_sha256,reconciliation:await reconcile(asset,scan,auth,account.account_id)};
  },
  close:async()=>{}
 };
}
module.exports={createV3X,graphic};
