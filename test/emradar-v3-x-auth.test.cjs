'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {createV3XAuth,SCOPES}=require('../src/emradar-v3-x-auth.cjs');
const {envConfig,memoryPg}=require('./fixtures/v3-x-postgres.cjs');
function fixture(options={}){
 const env={...envConfig(),...options.env},db=options.db||memoryPg(env),calls=[];let now=1000000;
 const fetcher=async(url,input={})=>{
  calls.push({url,input});
  if(options.respond){const result=await options.respond(url,input);if(result)return result;}
  const result=url.endsWith('/oauth2/token')?{access_token:'test-access-secret',refresh_token:'test-refresh-secret',expires_in:7200,scope:SCOPES.join(' ')}:{data:{id:'123',username:'test_owner'}};
  return {ok:true,status:200,json:async()=>result};
 };
 const auth=createV3XAuth({env,pool:db.pool,fetcher,clock:()=>now});
 return {env,db,auth,calls,advance:ms=>{now+=ms;},clock:()=>now,fetcher};
}
async function begin(f){const result=await f.auth.start({campaignId:'campaign',sessionId:'owner-session'});return new URL(result.authorization_url);}
async function connect(f){const url=await begin(f);const state=url.searchParams.get('state');return f.auth.complete({state,code:'test-code',campaignId:'campaign',sessionId:'owner-session'});}

test('schema initializes only the existing database; missing key/config fails before external calls',async()=>{
 const f=fixture();await f.auth.initialize();assert.equal(f.db.queries.length,2);
 assert(f.db.queries.every(q=>q.sql.startsWith('CREATE TABLE IF NOT EXISTS v3_x_')));
 const missing=fixture({env:{EMRADAR_V3_X_TOKEN_KEY:undefined}});
 await assert.rejects(begin(missing),/ENCRYPTION_KEY_REQUIRED/);assert.equal(missing.calls.length,0);assert.equal(missing.db.queries.length,0);
});

test('PKCE S256, scopes, fixed HTTPS callback and hashed single-use state persist across restart',async()=>{
 const f=fixture(),url=await begin(f),state=url.searchParams.get('state');
 assert.equal(url.origin,'https://x.com');assert.equal(url.searchParams.get('code_challenge_method'),'S256');
 assert.equal(url.searchParams.get('redirect_uri'),'https://review.example.org/api/review/x/callback');
 assert.equal(url.searchParams.get('scope'),SCOPES.join(' '));
 const digest=createHash('sha256').update(state).digest('hex'),pending=f.db.states.get(digest);
 const decoded=f.db.decrypt(pending.encrypted_pending,'oauth:'+digest);
 assert.equal(createHash('sha256').update(decoded.verifier).digest('base64url'),url.searchParams.get('code_challenge'));
 const persisted=JSON.stringify(f.db.queries);assert(!persisted.includes(state));assert(!persisted.includes(decoded.verifier));
 const restarted=createV3XAuth({env:f.env,pool:f.db.pool,fetcher:f.fetcher,clock:f.clock});
 assert.deepEqual(await restarted.context(state),{campaign_id:'campaign',session_id:'owner-session'});
 const result=await restarted.complete({state,code:'test-code',campaignId:'campaign',sessionId:'owner-session'});
 assert.equal(result.status,'CONNECTED');assert.equal(result.account_id,'123');
 const exchange=f.calls.find(c=>c.url.endsWith('/oauth2/token')).input;
 assert.equal(exchange.body.get('code_verifier'),decoded.verifier);assert.equal(exchange.body.get('redirect_uri'),url.searchParams.get('redirect_uri'));
 assert.match(exchange.headers.authorization,/^Basic /);
 await assert.rejects(restarted.complete({state,code:'test-code',campaignId:'campaign',sessionId:'owner-session'}),/OAUTH_STATE_INVALID/);
 assert.equal(f.calls.filter(c=>c.url.endsWith('/oauth2/token')).length,1);
});

test('stored tokens and PKCE secrets are encrypted; wrong key, altered ciphertext and different client fail closed',async()=>{
 const f=fixture();await connect(f);const raw=JSON.stringify(f.db.record());
 assert(!raw.includes('test-access-secret'));assert(!raw.includes('test-refresh-secret'));
 const restarted=createV3XAuth({env:f.env,pool:f.db.pool,fetcher:f.fetcher,clock:f.clock});
 assert.equal((await restarted.current()).account_id,'123');
 for(const env of [{...f.env,EMRADAR_V3_X_TOKEN_KEY:Buffer.alloc(32,9).toString('base64')},{...f.env,X_CLIENT_ID:'different-client'}]){
  await assert.rejects(createV3XAuth({env,pool:f.db.pool}).current(),/DECRYPTION_FAILED/);
 }
 const record=f.db.record();record.data=(record.data[0]==='A'?'B':'A')+record.data.slice(1);
 const altered={query:async()=>({rows:[{encrypted_record:record}]})};
 await assert.rejects(createV3XAuth({env:f.env,pool:altered}).current(),/DECRYPTION_FAILED/);
});

test('expired, forged, superseded and wrong-session OAuth state cannot exchange credentials',async()=>{
 const f=fixture(),first=await begin(f),second=await begin(f);
 await assert.rejects(f.auth.context(first.searchParams.get('state')),/OAUTH_STATE_INVALID/);
 const state=second.searchParams.get('state');
 await assert.rejects(f.auth.complete({state,code:'test',campaignId:'campaign',sessionId:'other-session'}),/OAUTH_STATE_INVALID/);
 await assert.rejects(f.auth.context('forged'),/OAUTH_STATE_INVALID/);
 f.advance(600001);await assert.rejects(f.auth.context(state),/OAUTH_STATE_INVALID/);
 assert.equal(f.calls.length,0);
});

test('denied grant, wrong account and missing scopes never replace an existing encrypted authorization',async()=>{
 for(const mode of ['denied','account','scope']){
  const f=fixture({respond:async url=>{
   if(mode==='account'&&url.endsWith('/users/me'))return {ok:true,json:async()=>({data:{id:'999',username:'other'}})};
   if(mode==='scope'&&url.endsWith('/oauth2/token'))return {ok:true,json:async()=>({access_token:'new-test',refresh_token:'new-refresh-test',expires_in:7200,scope:'users.read'})};
  }});
  f.db.seed({access_token:'prior-test',refresh_token:'prior-refresh-test',expires_at:9000000,account_id:'123',scope:SCOPES.join(' ')});
  const before=f.db.record(),url=await begin(f);
  await assert.rejects(f.auth.complete({state:url.searchParams.get('state'),code:'test',error:mode==='denied'?'access_denied':null,campaignId:'campaign',sessionId:'owner-session'}),/OAUTH_DENIED|ACCOUNT_MISMATCH|SCOPES_REQUIRED/);
  assert.deepEqual(f.db.record(),before);
 }
});

test('native refresh serializes competing V3 instances and persists encrypted renewal once',async()=>{
 const f=fixture();await connect(f);f.calls.length=0;f.advance(7200000);
 const second=createV3XAuth({env:f.env,pool:f.db.pool,fetcher:f.fetcher,clock:f.clock});
 await Promise.all([f.auth.current({allowRefresh:true}),second.current({allowRefresh:true})]);
 assert.equal(f.calls.filter(c=>c.url.endsWith('/oauth2/token')).length,1);
 assert.equal(f.db.read().refresh_attempt,undefined);assert.equal(f.db.read().account_id,'123');
 assert(f.db.queries.some(q=>q.sql.includes('pg_advisory_lock')));
 assert(!JSON.stringify(f.db.queries).includes('test-refresh-secret'));
});

test('expired read-only inspection never refreshes; ambiguous renewal remains guarded after restart',async()=>{
 const f=fixture({respond:async(_url,input)=>{if(input.body?.get('grant_type')==='refresh_token')throw Error('test response lost');}});
 await connect(f);f.calls.length=0;f.advance(7200000);
 await assert.rejects(f.auth.current(),/REFRESH_DISABLED/);assert.equal(f.calls.length,0);
 await assert.rejects(f.auth.current({allowRefresh:true}),/TOKEN_EXCHANGE_UNCONFIRMED/);
 assert(f.db.read().refresh_attempt);
 const restarted=createV3XAuth({env:f.env,pool:f.db.pool,fetcher:f.fetcher,clock:f.clock});
 await assert.rejects(restarted.current({allowRefresh:true}),/REFRESH_OUTCOME_UNKNOWN/);
 assert.equal(f.calls.length,1);
});

async function httpFixture(t){
 const {ReviewWorkflow}=await import('../vendor/emradar-v3/src/review-workflow.js');
 const {createOwnerSession}=await import('../vendor/emradar-v3/src/owner-sessions.js');
 const {createReviewServer}=await import('../vendor/emradar-v3/src/http.js');
 const f=fixture(),owner=createOwnerSession('campaign',{now:f.clock()});
 const campaign={phase:'PUBLICATION_REVIEW',assets:{x:{approved:'preserved'}},decisions:{x:{decision:'APPROVE'}},deliveries:{email:{status:'ACCEPTED'}}};
 const record={owner_session:{id:'owner-session',...owner.record}};
 const adapter={read:async key=>({value:structuredClone(key==='review:campaign'?record:campaign)}),compareAndSwap:async()=>{throw Error('NO_CAMPAIGN_WRITES');}};
 const workflow=new ReviewWorkflow({store:{adapter},adapter,notify:async()=>{throw Error('NO_EMAILS');},baseUrl:f.env.EMRADAR_V3_REVIEW_ORIGIN,clock:f.clock});
 const server=createReviewServer({workflow,xAuth:f.auth,releaseEmail:async()=>{throw Error('NO_RELEASE');}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const base='http://127.0.0.1:'+server.address().port;
 const suffix=createHash('sha256').update('campaign').digest('hex').slice(0,16);
 const cookie='emradar_v3_session_'+suffix+'=owner-session.'+owner.secret+'; emradar_v3_csrf=csrf';
 const request=(path,body={},headers={})=>fetch(base+'/api/review/x/'+path,{method:'POST',headers:{'content-type':'application/json',origin:f.env.EMRADAR_V3_REVIEW_ORIGIN,cookie,'x-emradar-csrf':'csrf',...headers},body:JSON.stringify(body)});
 return {...f,record,campaign,base,request};
}

test('Connect X requires real owner cookie, CSRF and same origin; callback remains tied to that owner session',async t=>{
 const f=await httpFixture(t),before=structuredClone(f.campaign);
 for(const headers of [{cookie:''},{'x-emradar-csrf':''},{origin:'https://other.example'},{origin:''}])assert.equal((await f.request('connect',{campaignId:'campaign'},headers)).status,403);
 assert.equal(f.db.states.size,0);assert.equal(f.calls.length,0);
 const start=await f.request('connect',{campaignId:'campaign'});assert.equal(start.status,200);
 const state=new URL((await start.json()).authorization_url).searchParams.get('state');
 assert.equal((await f.request('callback',{state,code:'test-code'},{'x-emradar-csrf':''})).status,403);
 assert.equal(f.calls.length,0);
 const done=await f.request('callback',{state,code:'test-code',campaignId:'forged-campaign'});
 assert.equal(done.status,200);assert.equal((await done.json()).status,'CONNECTED');
 assert.deepEqual(f.campaign,before);
 assert.equal((await f.request('callback',{state,code:'test-code'})).status,400);
 assert.equal(f.calls.filter(c=>c.url.endsWith('/oauth2/token')).length,1);
});

test('callback bridge handles Strict cookies without consuming state on GET or interpolating codes',async t=>{
 const f=await httpFixture(t),url=await begin(f),state=url.searchParams.get('state');
 const response=await fetch(f.base+'/api/review/x/callback?state='+state+'&code=test-sensitive-code');
 assert.equal(response.status,200);assert.equal(response.headers.get('referrer-policy'),'no-referrer');assert.match(response.headers.get('content-security-policy'),/script-src 'nonce-/);
 const html=await response.text();assert(!html.includes(state));assert(!html.includes('test-sensitive-code'));assert.match(html,/history.replaceState/);assert.match(html,/credentials:"same-origin"/);
 assert.equal(f.calls.length,0);assert.equal((await f.auth.context(state)).session_id,'owner-session');
});

test('revoked and expired owner sessions cannot complete OAuth or renew tokens',async t=>{
 const f=await httpFixture(t),url=await begin(f),state=url.searchParams.get('state');
 f.record.owner_session.revoked_at=f.clock();
 assert.equal((await f.request('callback',{state,code:'test-code'})).status,403);
 assert.equal((await f.request('status',{campaignId:'campaign'})).status,403);assert.equal(f.calls.length,0);
 f.record.owner_session.revoked_at=null;f.record.owner_session.expires_at=f.clock()-1;
 assert.equal((await f.request('callback',{state,code:'test-code'})).status,403);assert.equal(f.calls.length,0);
});
