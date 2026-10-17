'use strict';
// Adapted from emradar-marketing/server.js and runtime/x-authorization.js.
// No legacy HTTP dependency, connection, refresh or publication at construction.
const {createHash}=require('node:crypto');
const AUTH_KEYS=['marketing:x:authorized','marketing:x:authorized:emradar','emradar:x:authorized'];
const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
const assertScopes=auth=>{const scopes=new Set(String(auth.scope||'').split(' '));if(['tweet.read','tweet.write','users.read','media.write'].some(scope=>!scopes.has(scope)))fail('SCOPES_REQUIRED');};
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

function createV3X({env={},pool,fetcher=fetch,createClient,clock=()=>Date.now(),sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}){
 let client,connecting;
 const readEnabled=()=>env.EMRADAR_V3_X_READ_ENABLED==='true';
 const refreshOwned=()=>env.EMRADAR_V3_X_REFRESH_OWNER==='v3-after-legacy-shutdown';
 function assertEnabled(){
  if(env.EMRADAR_V3_X_PUBLISH_ENABLED!=='true')fail('PUBLISH_DISABLED');
  if(!refreshOwned())fail('LEGACY_SHUTDOWN_REQUIRED');
  assertReadConfig();
 }
 function assertReadConfig(){
  if(!readEnabled())fail('READ_DISABLED');
  if(!env.X_CLIENT_ID||(!/^\d+$/.test(env.X_ACCOUNT_ID||'')&&!/^[A-Za-z0-9_]{1,15}$/.test(env.X_ACCOUNT_USERNAME||'')))fail('ACCOUNT_CONFIG_REQUIRED');
  let url;try{url=new URL(env.KEY_VALUE_URL);}catch{fail('STORE_CONFIG_REQUIRED');}
  if(url.protocol!=='rediss:'||!url.password)fail('STORE_TLS_AUTH_REQUIRED');
 }
 async function store(){
  assertReadConfig();
  if(!client){
   const factory=createClient||require('redis').createClient;
   client=factory({url:env.KEY_VALUE_URL,disableOfflineQueue:true,socket:{connectTimeout:10000,reconnectStrategy:false}});
   client.on('error',()=>{}); // Never log a credential-bearing connection error.
  }
  try{
   if(!client.isOpen){
    if(!connecting)connecting=client.connect().finally(()=>{connecting=null;});
    await connecting;
   }
   return client;
  }catch{fail('STORE_UNAVAILABLE');}
 }
 async function load(){
  const redis=await store();
  for(const key of AUTH_KEYS){
   const raw=await redis.get(key);
   if(raw){let auth;try{auth=JSON.parse(raw);}catch{fail('AUTH_RECORD_INVALID');}if(typeof auth.access_token!=='string'||!Number.isFinite(auth.expires_at))fail('AUTH_RECORD_INVALID');return auth;}
  }
  fail('AUTH_REQUIRED'); // Never silently borrow Atlasoquence's account.
 }
 async function request(path,token,options={}){
  let response;try{response=await fetcher('https://api.x.com'+path,{...options,redirect:'error',signal:AbortSignal.timeout(20000),headers:{authorization:'Bearer '+token,...options.headers}});}catch{fail('NETWORK_OUTCOME_UNKNOWN');}
  const data=await response.json().catch(()=>null);
  if(!response.ok)fail('HTTP_'+response.status);
  if(!data&&response.status!==204)fail('RESPONSE_INVALID');
  if(data?.errors?.length)fail('RESPONSE_ERRORS');
  return data||{};
 }
 async function current({allowRefresh=false}={}){
  let auth=await load();
  if(auth.refresh_attempt)fail('REFRESH_OUTCOME_UNKNOWN');
  if(typeof auth.access_token!=='string'||!Number.isFinite(auth.expires_at))fail('AUTH_RECORD_INVALID');
  if(clock()<auth.expires_at-60000)return auth;
  if(!allowRefresh||!refreshOwned())fail('REFRESH_DISABLED');
  if(!pool?.connect)fail('REFRESH_LOCK_REQUIRED');
  const db=await pool.connect();
  try{
   await db.query("SELECT pg_advisory_lock(hashtext('emradar-v3-x-refresh'))");
   auth=await load(); // Every V3 instance re-reads under the shared DB lock.
   if(auth.refresh_attempt)fail('REFRESH_OUTCOME_UNKNOWN');
   if(clock()<auth.expires_at-60000)return auth;
   if(!auth.refresh_token)fail('REFRESH_TOKEN_REQUIRED');
   const redis=await store();
   await redis.set(AUTH_KEYS[0],JSON.stringify({...auth,refresh_attempt:{started_at:new Date(clock()).toISOString()}}));
   const headers={'content-type':'application/x-www-form-urlencoded'};
   if(env.X_CLIENT_SECRET)headers.authorization='Basic '+Buffer.from(env.X_CLIENT_ID+':'+env.X_CLIENT_SECRET).toString('base64');
   let response,data;
   try{
    response=await fetcher('https://api.x.com/2/oauth2/token',{method:'POST',redirect:'error',signal:AbortSignal.timeout(20000),headers,body:new URLSearchParams({grant_type:'refresh_token',refresh_token:auth.refresh_token,client_id:env.X_CLIENT_ID})});
    data=await response.json();
   }catch{fail('REFRESH_OUTCOME_UNKNOWN');}
   if(!response.ok||!data?.access_token||!Number.isFinite(Number(data.expires_in))||Number(data.expires_in)<=60)fail('REFRESH_OUTCOME_UNKNOWN');
   const next={...auth,...data,refreshed_at:new Date(clock()).toISOString(),expires_at:clock()+Number(data.expires_in)*1000};
   delete next.refresh_attempt;
   await redis.set(AUTH_KEYS[0],JSON.stringify(next));
   return next;
  }finally{
   try{await db.query("SELECT pg_advisory_unlock(hashtext('emradar-v3-x-refresh'))");}finally{db.release();}
  }
 }
 async function identity(auth){
  const result=await request('/2/users/me',auth.access_token);
  if(!/^\d+$/.test(result.data?.id||'')||(env.X_ACCOUNT_ID&&result.data.id!==env.X_ACCOUNT_ID)||(env.X_ACCOUNT_USERNAME&&String(result.data.username).toLowerCase()!==env.X_ACCOUNT_USERNAME.toLowerCase()))fail('ACCOUNT_MISMATCH');
  return {account_id:result.data.id,username:result.data.username};
 }
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
 async function prepare({asset,scan}){
  assertEnabled();
  asset=structuredClone(asset);
  const {bytes,mime}=graphic(asset);
  const auth=await current({allowRefresh:true});
  assertScopes(auth);
  const account=await identity(auth);
  const reconciliation=await reconcile(asset,scan,auth,account.account_id);
  return {asset_sha256:hash(JSON.stringify(canonical(asset))),publish:async()=>{
   assertEnabled();
   const init=await request('/2/media/upload/initialize',auth.access_token,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({media_type:mime,total_bytes:bytes.length,media_category:'tweet_image'})});
   const id=String(init.data?.id||init.data?.media_id||init.media_id_string||'');
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
   const post=await request('/2/tweets',auth.access_token,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({text:asset.body,media:{media_ids:[id]}})});
   if(!/^\d+$/.test(post.data?.id||''))fail('POST_RECEIPT_REQUIRED');
   return {accepted:true,receipt_id:post.data.id,post_url:'https://x.com/i/web/status/'+post.data.id,account_id:account.account_id,media_id:id,visual_sha256:asset.visual_sha256,reconciliation};
  }};
 }
 return {assertEnabled,prepare,
  verifyIdentity:async({allowRefresh=false}={})=>identity(await current({allowRefresh})),
  inspect:async({asset,scan})=>{
   graphic(asset);const auth=await current();assertScopes(auth);const account=await identity(auth);
   return {...account,visual_sha256:asset.visual_sha256,reconciliation:await reconcile(asset,scan,auth,account.account_id)};
  },
  close:async()=>{if(client?.isOpen)await client.quit();}
 };
}
module.exports={createV3X,graphic,AUTH_KEYS};
