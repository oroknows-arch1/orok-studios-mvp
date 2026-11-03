'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {draftConciseThread}=require('../src/emradar-x-thread-concise.cjs');
const {sydneyDay}=require('../src/emradar-audience-original-boundary.cjs');
const {createV3AudienceReview}=require('../src/emradar-audience-v3-review.cjs');
const {createV3ThreadPublication}=require('../src/emradar-audience-v3-publication.cjs');
const sha=x=>createHash('sha256').update(x).digest('hex');
const scanUrl='https://emradar.net/scans/2026-11-03';
const record=i=>({id:'r'+i,state:i===0?'INVESTIGATE':'CONFIRMED',evidence:[{fact:'Supplier '+i+' announced a plant.',url:'https://example.org/source/'+i}],causal_chain:{consequences:['Supplier '+i+' faces higher financing costs.'],industries:['Manufacturing']},contradictions:['Funding is not secured.']});
const document=n=>({publication_state:'PUBLISHED',snapshot_date:'2026-11-03',records:Array.from({length:n},(_,i)=>record(i))});
test('seven, eight and more than eight discoveries: standalone coverage, ranking and exclusions',()=>{
 for(const n of [1,7,8,11]){
  const d=document(n),p=draftConciseThread({document:d,scanUrl});
  assert.equal(p.segments.length,Math.min(n,8));assert.equal(p.excluded.length,Math.max(0,n-8));
  assert.equal(new Set(p.record_ids).size,p.segments.length);
  for(const s of p.segments){assert.equal(s.parent_sequence,null);assert.match(s.text,/financing costs/);assert.match(s.text,/Funding is not secured/);assert.equal(s.provenance.record_sha256,sha(JSON.stringify(d.records.find(r=>r.id===s.record_id))));assert.deepEqual(s.evidence_ids,[s.record_id+':0']);}
  if(n>8){assert(!p.record_ids.includes('r0'));assert(p.excluded.every(e=>e.reason==='DAILY_PRIORITY_LIMIT'));}
 }
});
test('unsupported financial angles are accounted for; duplicate IDs fail; no capacity filler',()=>{
 const d=document(2);delete d.records[0].causal_chain;const p=draftConciseThread({document:d,scanUrl});assert.equal(p.segments.length,1);assert.equal(p.excluded[0].reason,'NO_SUPPORTED_FINANCIAL_CONSEQUENCE');
 d.records[1].id=d.records[0].id;assert.throws(()=>draftConciseThread({document:d,scanUrl}),/RECORD_ID/);
});
test('writer instructions and varied conversational drafts retain exact findings and caveats',()=>{
 const d=document(3),openings=['That puts a squeeze on cash.','The bill lands with the supplier.','Worth watching the funding here.'];
 const drafts=Object.fromEntries(d.records.map((r,i)=>[r.id,{text:openings[i]+' '+r.causal_chain.consequences[0]+' '+r.contradictions[0]}]));
 const p=draftConciseThread({document:d,scanUrl,drafts});assert.equal(new Set(p.segments.map(s=>s.text.split('.')[0])).size,3);
 assert.match(p.writing_instructions,/Sean Walker/);assert.match(p.writing_instructions,/investment advice/);
 drafts.r0.text='Guaranteed profits.';assert.throws(()=>draftConciseThread({document:d,scanUrl,drafts}),/FINDING_OR_CAVEAT/);
});
test('Sydney midnight is independent of UTC and handles daylight saving',()=>{
 assert.equal(sydneyDay(Date.parse('2026-11-03T12:59:59Z')),'2026-11-03');assert.equal(sydneyDay(Date.parse('2026-11-03T13:00:00Z')),'2026-11-04');
 assert.equal(sydneyDay(Date.parse('2026-07-03T13:59:59Z')),'2026-07-03');assert.equal(sydneyDay(Date.parse('2026-07-03T14:00:00Z')),'2026-07-04');
});
async function reviewSetup(n=7){
 const {CampaignStore}=await import('../vendor/emradar-v3/src/state.js');const d=document(n),bytes=Buffer.from(JSON.stringify(d)),id='original-test',digest=sha(bytes);
 const png=await require('sharp')({create:{width:40,height:40,channels:3,background:'#164258'}}).png().toBuffer();
 const state={id,phase:'PUBLICATION_REVIEW',scan:{snapshot_date:d.snapshot_date,artifact_sha256:digest,source_key:d.snapshot_date+':'+digest},assets:{x:{asset:{kind:'X',destination_id:'x',campaign_id:id,body:'Saved scan graphic',visual_base64:png.toString('base64'),visual_sha256:sha(png),visual_mime:'image/png'}}},events:[],decisions:{},deliveries:{}};
 const values=new Map([[id,{version:1,value:state}],['review:'+id,{version:1,value:{status:'CONSUMED',token_hash:'token',owner_session:{id:'session',role:'OWNER',campaign_id:id,revoked_at:null,expires_at:Date.now()+600000}}}]]);
 const adapter={read:async key=>structuredClone(values.get(key)),compareAndSwap:async(key,version,value)=>{if((values.get(key)?.version??null)!==version)return false;values.set(key,{version:(version??0)+1,value:structuredClone(value)});return true;}};
 const store=new CampaignStore(adapter),review=createV3AudienceReview({store,loadPublishedBytes:async()=>bytes});
 const approve=async()=>{const r=await review.view(id);assert.deepEqual(r.problems,[]);await review.present(id,'session',{manifest_sha256:r.manifest_sha256,segment_hashes:r.segments.map(s=>s.asset_sha256)});await review.decide(id,'session','APPROVE',r.manifest_sha256);return r;};
 return {id,review,store,values,approve,bytes};
}
test('owner approval, complete review, provenance hashing and edited approval invalidation',async()=>{
 const s=await reviewSetup(),r=await s.review.view(s.id);assert.equal(r.segments.length,7);assert.equal(r.mode,'STANDALONE');assert.equal(await s.review.verify({campaign_id:s.id}),false);
 await assert.rejects(()=>s.review.decide(s.id,'session','APPROVE',r.manifest_sha256),/PRESENTATION_REQUIRED/);
 await s.approve();assert.equal(await s.review.verify({campaign_id:s.id}),true);
 await s.review.revise(s.id,r.manifest_sha256,{sequence:1,text:r.segments[0].text+' Watch the cost.'});
 assert.equal(await s.review.verify({campaign_id:s.id}),false);assert.equal(s.values.get(s.id).value.audience_x_approval,undefined);
 await assert.rejects(()=>s.review.decide(s.id,'session','APPROVE',r.manifest_sha256),/STALE/);
 await s.approve();assert.equal(await s.review.verify({campaign_id:s.id}),true);
});
const url=process.env.V3_TEST_DATABASE_URL;
test('PostgreSQL: concurrent workers, account ceiling, external originals, retries, ambiguity and midnight', {skip:!url},async()=>{
 const {Pool}=require('pg'),{ThreadStore}=require('../src/emradar-x-thread-store.cjs');const pool=await require('./audience-postgres-fixture.cjs').isolatedAudiencePool(url),store=new ThreadStore(pool);
 const account=String(Date.now()),prefix='originals-'+account;let now=Date.parse('2026-11-03T12:59:00Z'),history=[];
 const loadHistory=async({account_id,day})=>({complete:true,account_id,day,posts:history.filter(p=>sydneyDay(Date.parse(p.created_at))===day)});
 const attempts=[];
 try{
  await store.initialize();await store.initializeOriginals();
  for(let i=0;i<12;i++)await store.register({campaign_id:prefix+i,approved_segments:[{sequence:1,kind:'DISCOVERY',record_id:'r'+i,parent_sequence:null,text:'Financial consequence '+i,approval_status:'APPROVED'}]});
  const run=(i,opts={})=>store.reserveOriginal({account_id:account,campaign_id:prefix+i,sequence:1,segment:{record_id:'r'+i,parent_sequence:null,text:'Financial consequence '+i},source_key:'scan',loadHistory,verifyApproval:async()=>true,clock:()=>now,submit:async({beforePost})=>{await beforePost();attempts.push(i);if(opts.fail)throw Error('X_HTTP_500');const receipt_id=String(500000+i);history.push({id:receipt_id,created_at:new Date(now).toISOString()});await store.record({campaign_id:prefix+i,sequence:1,receipt_id});return receipt_id;},...opts});
  // Already-published originals outside this worker consume allowance.
  history.push({id:'499999',created_at:new Date(now).toISOString()});
  const first=await Promise.allSettled(Array.from({length:10},(_,i)=>run(i)));
  assert.equal(first.filter(r=>r.status==='fulfilled').length,7);assert.equal(attempts.length,7);assert.equal(history.length,8);
  await assert.rejects(()=>run(attempts[0]),/LIMIT|ALREADY_ATTEMPTED/);assert.equal(attempts.length,7);
  await store.register({campaign_id:prefix+'duplicate',approved_segments:[{sequence:1,kind:'DISCOVERY',record_id:'r'+attempts[0],parent_sequence:null,text:'Same discovery, different wording',approval_status:'APPROVED'}]});
  now=Date.parse('2026-11-03T13:01:00Z');
  await assert.rejects(()=>store.reserveOriginal({account_id:account,campaign_id:prefix+'duplicate',sequence:1,segment:{record_id:'r'+attempts[0],parent_sequence:null,text:'Same discovery, different wording'},source_key:'scan',loadHistory,verifyApproval:async()=>true,clock:()=>now,submit:async()=>{throw Error('SHOULD_NOT_POST')}}),/duplicate key/);
  const remaining=Array.from({length:12},(_,i)=>i).filter(i=>!attempts.includes(i));
  await assert.rejects(()=>run(remaining[0],{fail:true}),/X_HTTP_500/);
  const ambiguous=(await store.list(prefix+remaining[0]))[0];assert.equal(ambiguous.status,'AMBIGUOUS');
  await assert.rejects(()=>run(remaining[0]),/ALREADY_ATTEMPTED/);
  // Restarted worker/store cannot retry an uncertain submission.
  const restarted=new ThreadStore(pool);assert.equal((await restarted.list(prefix+remaining[0]))[0].status,'AMBIGUOUS');
  let verified=false;await assert.rejects(()=>run(remaining[1],{verifyApproval:async()=>verified}),/APPROVAL_STALE/);verified=true;
  await run(remaining[1]);assert.equal((await store.list(prefix+remaining[1]))[0].parent_receipt_id,null);
  history=Array.from({length:7},(_,i)=>({id:String(700000+i),created_at:new Date(now).toISOString()}));
  await assert.rejects(()=>run(remaining[3]),/DAILY_ORIGINAL_LIMIT/);
  // Cross midnight during media upload: today's eight external originals block POST.
  now=Date.parse('2026-11-04T12:59:59Z');history=[];
  await assert.rejects(()=>run(remaining[2],{submit:async({beforePost})=>{now=Date.parse('2026-11-04T13:00:01Z');history=Array.from({length:8},(_,i)=>({id:String(800000+i),created_at:new Date(now).toISOString()}));await beforePost();throw Error('SHOULD_NOT_POST')}}),/DAILY_ORIGINAL_LIMIT/);
 }finally{await pool.query('DELETE FROM emradar_x_thread_posts WHERE campaign_id LIKE $1',[prefix+'%']);await pool.end();}
});
test('publisher refuses legacy thread manifests before any external action',async()=>{
 const s=await reviewSetup(1);await s.approve();s.values.get(s.id).value.audience_x_review.mode='LEGACY_THREAD';let called=false;
 const run=createV3ThreadPublication({campaignStore:s.store,threadStore:{ensureRegistered:async()=>{}},review:s.review,x:{prepareThreadPost:async()=>{called=true}},enabled:true});
 await assert.rejects(()=>run(s.id),/APPROVAL_NOT_VERIFIED|STANDALONE_BOUNDARY/);assert.equal(called,false);
});

test('independent composition authenticates review, writes audience-only state and contains failed publication', {skip:!url},async()=>{
 const {Pool}=require('pg'),{createIndependentAudience}=require('../src/emradar-audience-independent.cjs');
 const source=await reviewSetup(3),pool=await require('./audience-postgres-fixture.cjs').isolatedAudiencePool(url,4),before=JSON.stringify([...source.values]);
 const id=source.id;let calls=0;
 const x={originalHistory:async({account_id,day})=>({complete:true,account_id,day,posts:[]}),prepareThreadPost:async()=>({account_id:'998877',publish:async({beforePost})=>{await beforePost();calls++;if(calls===2)throw Error('X_API_503');return {accepted:true,receipt_id:'99880001'};}}),reconcileThreadPost:async()=>({status:'UNRESOLVED'})};
 try{
  const engine=await createIndependentAudience({audiencePool:pool,readSource:async key=>source.store.adapter.read(key),readOwnerAccess:async key=>source.store.adapter.read('review:'+key),authenticateOwner:async(cid,sid,secret)=>{if(cid!==id||sid!=='session'||secret!=='owner-secret')throw Error('OWNER_SESSION_REQUIRED')},loadPublishedBytes:async()=>source.bytes,x,publishEnabled:true});
  await engine.prepare(id);await assert.rejects(()=>engine.view(id,'session','spoof'),/OWNER_SESSION_REQUIRED/);
  let view=await engine.view(id,'session','owner-secret'),r=view.xThread;assert.equal(r.segments.length,3);
  await assert.rejects(()=>engine.run(id),/APPROVAL_NOT_VERIFIED/);assert.equal(calls,0);
  await engine.present(id,'session','owner-secret',{manifest_sha256:r.manifest_sha256,segment_hashes:r.segments.map(s=>s.asset_sha256)});
  for(const segment of r.segments)await engine.postDecision(id,'session','owner-secret',segment.record_id,'APPROVE',r.manifest_sha256,segment.asset_sha256);
  await engine.decide(id,'session','owner-secret','APPROVE',r.manifest_sha256);
  assert.equal((await engine.run(id)).status,'HALTED_AMBIGUOUS');assert.equal(calls,2);
  assert.equal((await engine.run(id)).status,'HALTED_AMBIGUOUS');assert.equal(calls,2);
  assert.equal(JSON.stringify([...source.values]),before);
 }finally{await pool.query('DELETE FROM emradar_x_thread_posts WHERE campaign_id=$1',[id]);await pool.query('DELETE FROM emradar_audience_state WHERE key=$1',[id]);await pool.end();}
});
