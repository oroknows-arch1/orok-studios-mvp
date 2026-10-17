'use strict';
const {randomBytes,createHash,createCipheriv,createDecipheriv}=require('node:crypto');
const SCOPES=['tweet.read','tweet.write','users.read','media.write','offline.access'];
const fail=code=>{throw Error('V3_X_'+code);};
const hash=value=>createHash('sha256').update(value).digest('hex');
function assertScopes(auth){const scopes=new Set(String(auth.scope||'').split(' '));if(SCOPES.some(scope=>!scopes.has(scope)))fail('SCOPES_REQUIRED');}

function createV3XAuth({env={},pool,fetcher=fetch,clock=()=>Date.now()}={}){
 function config(){
  if(!env.X_CLIENT_ID||(!/^\d+$/.test(env.X_ACCOUNT_ID||'')&&!/^[A-Za-z0-9_]{1,15}$/.test(env.X_ACCOUNT_USERNAME||'')))fail('ACCOUNT_CONFIG_REQUIRED');
  let origin;try{origin=new URL(env.EMRADAR_V3_REVIEW_ORIGIN);}catch{fail('OAUTH_CONFIG_REQUIRED');}
  if(origin.protocol!=='https:'||origin.username||origin.password||origin.search||origin.hash||origin.pathname!=='/')fail('OAUTH_CONFIG_REQUIRED');
  const encoded=env.EMRADAR_V3_X_TOKEN_KEY;
  const key=typeof encoded==='string'?Buffer.from(encoded,'base64'):Buffer.alloc(0);
  if(key.length!==32||key.toString('base64')!==encoded)fail('ENCRYPTION_KEY_REQUIRED');
  return {key,callback:origin.origin+'/api/review/x/callback'};
 }
 function seal(value,purpose){
  const {key}=config(),iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);
  cipher.setAAD(Buffer.from('emradar-v3:x:v1:'+env.X_CLIENT_ID+':'+purpose));
  const data=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);
  return {v:1,iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:data.toString('base64')};
 }
 function open(envelope,purpose){
  const {key}=config();
  try{
   if(envelope?.v!==1)fail('ENCRYPTED_RECORD_INVALID');
   const iv=Buffer.from(envelope.iv,'base64'),tag=Buffer.from(envelope.tag,'base64');
   if(iv.length!==12||tag.length!==16)fail('ENCRYPTED_RECORD_INVALID');
   const decipher=createDecipheriv('aes-256-gcm',key,iv);
   decipher.setAAD(Buffer.from('emradar-v3:x:v1:'+env.X_CLIENT_ID+':'+purpose));decipher.setAuthTag(tag);
   return JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.data,'base64')),decipher.final()]).toString('utf8'));
  }catch{fail('DECRYPTION_FAILED');}
 }
 async function initialize(){
  await pool.query(`CREATE TABLE IF NOT EXISTS v3_x_authorization (
   account_key TEXT PRIMARY KEY CHECK(account_key='x'),encrypted_record JSONB NOT NULL,updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS v3_x_oauth_states (
   state_hash TEXT PRIMARY KEY,campaign_id TEXT NOT NULL,session_id TEXT NOT NULL,
   encrypted_pending JSONB NOT NULL,expires_at TIMESTAMPTZ NOT NULL,consumed_at TIMESTAMPTZ)`);
 }
 async function load(db=pool){
  config();
  const {rows}=await db.query("SELECT encrypted_record FROM v3_x_authorization WHERE account_key='x'");
  if(!rows[0])fail('AUTH_REQUIRED');
  const auth=open(rows[0].encrypted_record,'authorization');
  if(typeof auth.access_token!=='string'||!Number.isFinite(auth.expires_at))fail('AUTH_RECORD_INVALID');
  return auth;
 }
 async function save(auth,db=pool){
  await db.query("INSERT INTO v3_x_authorization(account_key,encrypted_record) VALUES('x',$1::jsonb) ON CONFLICT(account_key) DO UPDATE SET encrypted_record=EXCLUDED.encrypted_record,updated_at=now()",[JSON.stringify(seal(auth,'authorization'))]);
 }
 async function locked(run){
  if(!pool?.connect)fail('REFRESH_LOCK_REQUIRED');
  const db=await pool.connect();
  try{await db.query("SELECT pg_advisory_lock(hashtext('emradar-v3-x-refresh'))");return await run(db);}
  finally{try{await db.query("SELECT pg_advisory_unlock(hashtext('emradar-v3-x-refresh'))");}finally{db.release();}}
 }
 async function exchange(body){
  config();
  const headers={'content-type':'application/x-www-form-urlencoded'};
  if(env.X_CLIENT_SECRET)headers.authorization='Basic '+Buffer.from(env.X_CLIENT_ID+':'+env.X_CLIENT_SECRET).toString('base64');
  let response,data;
  try{
   response=await fetcher('https://api.x.com/2/oauth2/token',{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers,body:new URLSearchParams({...body,client_id:env.X_CLIENT_ID})});
   data=await response.json();
  }catch{fail('TOKEN_EXCHANGE_UNCONFIRMED');}
  if(!response.ok||!data?.access_token||!Number.isFinite(Number(data.expires_in))||Number(data.expires_in)<=60)fail('TOKEN_EXCHANGE_UNCONFIRMED');
  return data;
 }
 function normalized(token,previous={}){
  const auth={...previous,...token,scope:token.scope||previous.scope,authorized_at:previous.authorized_at||new Date(clock()).toISOString(),expires_at:clock()+Number(token.expires_in)*1000};
  delete auth.refresh_attempt;
  if(!auth.refresh_token)fail('REFRESH_TOKEN_REQUIRED');assertScopes(auth);return auth;
 }
 async function verifyAccount(auth){
  let response,result;
  try{
   response=await fetcher('https://api.x.com/2/users/me',{redirect:'error',signal:AbortSignal.timeout(15000),headers:{authorization:'Bearer '+auth.access_token}});
   result=await response.json();
  }catch{fail('ACCOUNT_VERIFICATION_FAILED');}
  if(!response.ok||result.errors?.length||!/^\d+$/.test(result.data?.id||'')||(env.X_ACCOUNT_ID&&result.data.id!==env.X_ACCOUNT_ID)||(env.X_ACCOUNT_USERNAME&&String(result.data.username).toLowerCase()!==env.X_ACCOUNT_USERNAME.toLowerCase()))fail('ACCOUNT_MISMATCH');
  return {account_id:result.data.id,username:result.data.username};
 }
 async function current({allowRefresh=false}={}){
  let auth=await load();
  if(auth.refresh_attempt)fail('REFRESH_OUTCOME_UNKNOWN');
  if(clock()<auth.expires_at-60000)return auth;
  if(!allowRefresh)fail('REFRESH_DISABLED');
  return locked(async db=>{
   auth=await load(db);
   if(auth.refresh_attempt)fail('REFRESH_OUTCOME_UNKNOWN');
   if(clock()<auth.expires_at-60000)return auth;
   if(!auth.refresh_token)fail('REFRESH_TOKEN_REQUIRED');
   // Commit the ambiguity guard before the external request. A rollback must
   // never erase evidence that a rotating refresh may already have succeeded.
   await save({...auth,refresh_attempt:{started_at:new Date(clock()).toISOString()}},db);
   const next=normalized(await exchange({grant_type:'refresh_token',refresh_token:auth.refresh_token}),auth);
   const account=await verifyAccount(next);
   if(auth.account_id&&account.account_id!==auth.account_id)fail('ACCOUNT_MISMATCH');
   Object.assign(next,account,{refreshed_at:new Date(clock()).toISOString()});
   await save(next,db);return next;
  });
 }
 function stateHash(state){if(typeof state!=='string'||!/^[-_A-Za-z0-9]{43}$/.test(state))fail('OAUTH_STATE_INVALID');return hash(state);}
 async function context(state){
  config();const digest=stateHash(state);
  const {rows}=await pool.query('SELECT campaign_id,session_id FROM v3_x_oauth_states WHERE state_hash=$1 AND consumed_at IS NULL AND expires_at>$2',[digest,new Date(clock())]);
  if(!rows[0])fail('OAUTH_STATE_INVALID');return rows[0];
 }
 // Owner session/CSRF verification belongs to the existing review HTTP boundary.
 async function start({campaignId,sessionId}){
  const {callback}=config();
  const state=randomBytes(32).toString('base64url'),verifier=randomBytes(32).toString('base64url'),digest=stateHash(state);
  await locked(async db=>{
   // Keep only the latest active connection attempt; consumed rows remain audit.
   await db.query('UPDATE v3_x_oauth_states SET expires_at=$1 WHERE consumed_at IS NULL AND expires_at>$1',[new Date(clock())]);
   await db.query('INSERT INTO v3_x_oauth_states(state_hash,campaign_id,session_id,encrypted_pending,expires_at) VALUES($1,$2,$3,$4::jsonb,$5)',[digest,campaignId,sessionId,JSON.stringify(seal({verifier,campaignId,sessionId},'oauth:'+digest)),new Date(clock()+600000)]);
  });
  const query=new URLSearchParams({response_type:'code',client_id:env.X_CLIENT_ID,redirect_uri:callback,scope:SCOPES.join(' '),state,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'});
  return {authorization_url:'https://x.com/i/oauth2/authorize?'+query};
 }
 async function complete({state,code,error,campaignId,sessionId}){
  const {callback}=config(),digest=stateHash(state);
  return locked(async db=>{
   const {rows}=await db.query('UPDATE v3_x_oauth_states SET consumed_at=$2 WHERE state_hash=$1 AND consumed_at IS NULL AND expires_at>$2 AND campaign_id=$3 AND session_id=$4 RETURNING encrypted_pending',[digest,new Date(clock()),campaignId,sessionId]);
   if(!rows[0])fail('OAUTH_STATE_INVALID');
   const pending=open(rows[0].encrypted_pending,'oauth:'+digest);
   if(pending.campaignId!==campaignId||pending.sessionId!==sessionId)fail('OAUTH_STATE_INVALID');
   if(error)fail('OAUTH_DENIED');
   if(typeof code!=='string'||!code.length||code.length>4096)fail('OAUTH_CODE_INVALID');
   const auth=normalized(await exchange({grant_type:'authorization_code',code,redirect_uri:callback,code_verifier:pending.verifier}));
   const account=await verifyAccount(auth);Object.assign(auth,account);
   await save(auth,db);
   return {status:'CONNECTED',...account,review_url:'/review/access?campaign='+encodeURIComponent(campaignId)};
  });
 }
 return {initialize,current,start,context,complete,verifyAccount};
}
module.exports={createV3XAuth,assertScopes,SCOPES};
