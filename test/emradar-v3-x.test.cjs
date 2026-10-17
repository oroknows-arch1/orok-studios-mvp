'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {createV3X,graphic}=require('../src/emradar-v3-x.cjs');
const {createV3PreparedIntegration}=require('../src/emradar-v3-integration.cjs');
const {createV3Release}=require('../src/emradar-v3-release.cjs');
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jq1sAAAAASUVORK5CYII=';
const bytes=Buffer.from(png,'base64'),sha=content=>createHash('sha256').update(content).digest('hex');
const asset=()=>({campaign_id:'campaign',destination_id:'x',kind:'X',body:'Exact approved evidence and possibilities.',visual_base64:png,visual_mime:'image/png',visual_sha256:sha(bytes),visual_url:'data:image/png;base64,'+png});
const config=()=>({...envConfig(),EMRADAR_V3_X_PUBLISH_ENABLED:'true'});
const {envConfig,memoryPg}=require('./fixtures/v3-x-postgres.cjs');
const scope='tweet.read tweet.write users.read media.write offline.access';
function transport(options={}){
 const env=options.env||config(),calls=[],db=memoryPg(env.X_CLIENT_ID?env:config());
 db.seed({access_token:'test-access',refresh_token:'test-refresh',expires_at:options.expired?900000:9000000,scope,account_id:'123'});
 const pool=db.pool;
 const fetcher=async(url,init={})=>{
  calls.push({url,method:init.method||'GET',body:init.body});
  if(options.respond){const custom=await options.respond(url,init,calls);if(custom)return custom;}
  let data;
  if(url.endsWith('/oauth2/token'))data={access_token:'test-refreshed',refresh_token:'test-next-refresh',expires_in:7200,scope};
  else if(url.endsWith('/users/me'))data={data:{id:'123',username:'test_owner'}};
  else if(url.includes('/users/123/tweets'))data={meta:{result_count:0}};
  else if(url.endsWith('/initialize'))data={data:{id:'456'}};
  else if(url.endsWith('/append'))return {ok:true,status:204,json:async()=>{throw Error('empty');}};
  else if(url.endsWith('/finalize'))data={data:{processing_info:{state:'pending',check_after_secs:0}}};
  else if(url.includes('command=STATUS'))data={data:{processing_info:{state:'succeeded'}}};
  else if(url.endsWith('/tweets'))data={data:{id:'789'}};
  else throw Error('UNEXPECTED_TEST_ENDPOINT');
  return {ok:true,status:200,json:async()=>data};
 };
 const x=createV3X({env,pool,clock:()=>1000000,sleep:async()=>{},fetcher});
 return {x,env,calls,db,pool};
}
const response=data=>({ok:true,status:200,json:async()=>data});
const prepare=f=>f.x.prepare({asset:asset(),scan:{snapshot_date:'2026-10-10'}});

test('default construction and disabled release never connect or post',async()=>{
 let accessed=0;
 const x=createV3X({pool:{query:async()=>{accessed++;throw Error('NO_CONNECT');}},fetcher:async()=>{accessed++;}});
 await assert.rejects(x.prepare({asset:asset()}),/PUBLISH_DISABLED/);
 await assert.rejects(x.verifyIdentity(),/ACCOUNT_CONFIG_REQUIRED/);assert.equal(accessed,0);
});

test('account identity, byte hash and exact graphic are checked before uploading',async()=>{
 const wrong=transport({respond:async url=>url.endsWith('/users/me')?response({data:{id:'999'}}):null});
 await assert.rejects(prepare(wrong),/ACCOUNT_MISMATCH/);assert.equal(wrong.calls.length,1);
 assert.throws(()=>graphic({...asset(),visual_base64:Buffer.from('changed graphic').toString('base64')}),/DIGEST_MISMATCH/);
 assert.throws(()=>graphic({...asset(),visual_base64:undefined,visual_url:'https://untrusted.example/image'}),/GRAPHIC_REQUIRED/);
});

test('existing exact post, incomplete history and missing evidence all block before upload',async()=>{
 for(const history of [
  {data:[{text:asset().body}],meta:{result_count:1}},
  {data:[{text:'truncated…'}],meta:{result_count:1}},
  {meta:{result_count:0,next_token:'more'}},
  {}
 ]){
  const f=transport({respond:async url=>url.includes('/users/123/tweets')?response(history):null});
  await assert.rejects(prepare(f),/ALREADY_PUBLISHED|HISTORY_INCOMPLETE|HISTORY_UNKNOWN/);
  assert.equal(f.calls.some(c=>c.method==='POST'),false);
 }
});

test('approved text and exact graphic upload together; processing completes before post and receipt retains evidence',async()=>{
 const f=transport(),prepared=await prepare(f);
 assert.equal(f.calls.some(c=>c.method==='POST'),false);
 const result=await prepared.publish();
 const append=f.calls.find(c=>c.url.endsWith('/append'));
 assert.deepEqual(Buffer.from(await append.body.get('media').arrayBuffer()),bytes);
 const post=f.calls.find(c=>c.url.endsWith('/2/tweets'));
 assert.deepEqual(JSON.parse(post.body),{text:asset().body,media:{media_ids:['456']}});
 assert(f.calls.findIndex(c=>c.url.includes('command=STATUS'))<f.calls.indexOf(post));
 assert.equal(result.receipt_id,'789');assert.equal(result.visual_sha256,asset().visual_sha256);
 assert.equal(result.reconciliation.status,'VERIFIED_NOT_PUBLISHED');assert.equal(result.account_id,'123');
});

test('failed or persistently pending media never becomes a text-only post',async()=>{
 for(const state of ['failed','pending']){
  const f=transport({respond:async url=>url.includes('command=STATUS')?response({data:{processing_info:{state,check_after_secs:0}}}):null});
  await assert.rejects((await prepare(f)).publish(),/MEDIA_PROCESSING_FAILED|MEDIA_PROCESSING_INCOMPLETE/);
  assert.equal(f.calls.some(c=>c.url.endsWith('/2/tweets')),false);
 }
});

async function integrationFixture(options={}){
 const {CampaignStore}=await import('../vendor/emradar-v3/src/state.js');
 const {sha256}=await import('../vendor/emradar-v3/src/contracts.js');
 const approved=asset(),fingerprint=sha256(approved);
 let state={id:'campaign',scan:{snapshot_date:'2026-10-10'},phase:'PUBLICATION_REVIEW',assets:{x:{asset:approved,fingerprint}},decisions:{x:{authority:'OWNER',decision:'APPROVE',asset_sha256:fingerprint,campaign_id:'campaign',destination_id:'x'}},deliveries:{},destinations:[{id:'x'}],events:[]},version=1;
 const reservations=new Map();let authenticated=0;
 const adapter={read:async()=>({value:structuredClone(state),version}),compareAndSwap:async(_id,prior,next)=>{if(prior!==version)return false;state=structuredClone(next);version++;return true;}};
 const store=new CampaignStore(adapter),f=transport(options);
 const pool={query:async(sql,args)=>{
  if(sql.startsWith('SELECT payload'))return {rows:[{payload:structuredClone(state)}]};
  if(sql.includes('INSERT INTO v3_send_reservations')){if(reservations.has(args[0]))return {rowCount:0};reservations.set(args[0],{status:'RESERVED'});return {rowCount:1};}
  if(sql.startsWith('UPDATE v3_send_reservations')){const row=reservations.get(args[0]);if(row.status!=='RESERVED')return {rowCount:0};Object.assign(row,{status:args[1],provider_id:args[2]});return {rowCount:1};}
  throw Error('UNEXPECTED_SQL');
 }};
 const prepareApprovedX=payload=>f.x.prepare({asset:payload.asset,scan:state.scan});
 const integration=createV3PreparedIntegration({pool,token:'test'.repeat(12),reviewOrigin:'https://review.example.org',sendOwnerReview:async()=>{throw Error('NO_EMAIL');},sendApprovedEmail:async()=>{throw Error('NO_EMAIL');},prepareApprovedX});
 integration.prepareApprovedX=prepareApprovedX;
 const service={store,workflow:{authenticate:async(_campaign,id,secret)=>{if(id!=='session'||secret!=='private')throw Error('ACCESS_DENIED');authenticated++;}}};
 const release=()=>createV3Release({service,integration,pool});
 const input={campaignId:'campaign',destinationId:'x',sessionId:'session',sessionSecret:'private'};
 return {f,state:()=>state,mutate:fn=>fn(state),reservations,release,input,authenticated:()=>authenticated};
}

test('real campaign claim, approval verifier, boundary and receipt route preserve state and block restart duplicates',async()=>{
 const f=await integrationFixture(),before=f.state();
 const result=await f.release()(f.input);
 assert.equal(result.receipt_id,'789');assert.equal(f.state().deliveries.x.receipt.provider_id,'789');
 assert.equal([...f.reservations.values()][0].status,'ACCEPTED');assert.equal([...f.reservations.values()][0].provider_id,'789');
 assert.deepEqual(f.state().assets,before.assets);assert.deepEqual(f.state().decisions,before.decisions);
 await assert.rejects(f.release()(f.input),/RELEASE_NOT_APPROVED/);
 assert.equal(f.f.calls.filter(c=>c.url.endsWith('/2/tweets')).length,1);
});

test('missing session, rejected approval and changed approved content cannot post',async()=>{
 const f=await integrationFixture();
 await assert.rejects(f.release()({...f.input,sessionSecret:'forged'}),/ACCESS_DENIED/);
 f.mutate(s=>s.decisions.x.decision='REJECT');
 await assert.rejects(f.release()(f.input),/RELEASE_NOT_APPROVED/);
 f.mutate(s=>{s.decisions.x.decision='APPROVE';s.assets.x.asset.body='tampered';});
 await assert.rejects(f.release()(f.input),/OWNER_APPROVAL_REQUIRED|PREPARED_ASSET_MISMATCH|DURABLE_APPROVAL_MISMATCH/);
 assert.equal(f.f.calls.some(c=>c.method==='POST'),false);
});

test('disabled publishing and unknown prior publication leave campaign and claims untouched',async()=>{
 for(const options of [{env:{}},{respond:async url=>url.includes('/users/123/tweets')?response({}):null}]){
  const f=await integrationFixture(options),before=structuredClone(f.state());
  await assert.rejects(f.release()(f.input),/PUBLISH_DISABLED|HISTORY_UNKNOWN/);
  assert.deepEqual(f.state(),before);assert.equal(f.reservations.size,0);
 }
});

test('lost post response is durably ambiguous and never repeated',async()=>{
 const f=await integrationFixture({respond:async url=>{if(url.endsWith('/2/tweets'))throw Error('test lost response');}});
 await assert.rejects(f.release()(f.input),/OUTCOME_AMBIGUOUS/);
 assert.equal(f.state().deliveries.x.status,'AMBIGUOUS');assert.equal([...f.reservations.values()][0].status,'AMBIGUOUS');
 await assert.rejects(f.release()(f.input),/RELEASE_NOT_APPROVED/);
 assert.equal(f.f.calls.filter(c=>c.url.endsWith('/2/tweets')).length,1);
});


test('owner handle can pin the existing account without a separate numeric-ID lookup; inspection never writes',async()=>{
 const f=transport({env:{...config(),X_ACCOUNT_ID:undefined,X_ACCOUNT_USERNAME:'test_owner'}}),before=f.db.record();
 const result=await f.x.inspect({asset:asset(),scan:{snapshot_date:'2026-10-10'}});
 assert.equal(result.account_id,'123');assert.equal(result.reconciliation.status,'VERIFIED_NOT_PUBLISHED');
 assert.equal(f.calls.some(c=>c.method!=='GET'),false);assert.deepEqual(f.db.record(),before);
});

test('missing media scope blocks preparation and truncated or inconsistent history cannot establish non-publication',async()=>{
 const f=transport();const auth=f.db.read();auth.scope='tweet.read users.read';f.db.seed(auth);
 await assert.rejects(prepare(f),/SCOPES_REQUIRED/);assert.equal(f.calls.length,0);
 const incomplete=transport({respond:async url=>url.includes('/users/123/tweets')?response({meta:{result_count:1}}):null});
 await assert.rejects(prepare(incomplete),/HISTORY_UNKNOWN/);
});
