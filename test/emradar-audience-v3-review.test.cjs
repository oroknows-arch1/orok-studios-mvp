'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {createV3AudienceReview}=require('../src/emradar-audience-v3-review.cjs');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function setup(pool=null){
 const {CampaignStore}=await import('../vendor/emradar-v3/src/state.js');
 const {ReviewWorkflow}=await import('../vendor/emradar-v3/src/review-workflow.js');
 const record={id:'indonesia-equity-market-accessibility-crisis',theme:'Market governance',status:'CONFIRMED',why_surfaced:'A consultation is open.',causal_chain:{world_change:['Index review'],pressure:['Ownership concerns'],bottleneck_or_scarcity:['Verified free float'],formation:['Market governance as access condition'],industries:['Capital markets'],connected_companies_and_tickers:['BREN (IDX)'],consequences:['Potential outflows']},contradictions:['Consultation is not a final downgrade.'],chain_evolution:{unresolved_evidence:['Final decision'],break_conditions:['Reforms accepted']},evidence:[{fact:'Consultation launched',date:'2026-10-15',url:'https://example.org/evidence'}]};
 const source=pool&&process.env.EMRADAR_STAGING_PUBLISHED_FILE?require('node:fs').readFileSync(process.env.EMRADAR_STAGING_PUBLISHED_FILE):null;
 const document=source?JSON.parse(source):{publication_state:'PUBLISHED',snapshot_date:'2026-10-17',records:[record,{...record,id:'copper',status:'INVESTIGATE'}]};
 const bytes=source??Buffer.from(JSON.stringify(document)),digest=hash(bytes),id=pool?'staging-'+require('node:crypto').randomUUID():'staging-campaign';
 const sharp=require('sharp'),png=await sharp({create:{width:40,height:40,channels:3,background:'#164258'}}).png().toBuffer();
 const asset={kind:'X',destination_id:'x',campaign_id:id,body:'Consultation is not a final downgrade.',visual_base64:png.toString('base64'),visual_sha256:hash(png),visual_mime:'image/png'};
 if(pool&&process.env.EMRADAR_STAGING_X_ASSET_FILE)Object.assign(asset,JSON.parse(require('node:fs').readFileSync(process.env.EMRADAR_STAGING_X_ASSET_FILE,'utf8')));
 const data=new Map([[id,{version:1,value:{id,phase:'PUBLICATION_REVIEW',scan:{snapshot_date:document.snapshot_date,artifact_sha256:digest,source_key:document.snapshot_date+':'+digest},assets:{x:{asset,fingerprint:'legacy'}},destinations:[{id:'x'}],decisions:{},deliveries:{},events:[],preparation_input:{document}}}]]);
 let adapter={read:async key=>structuredClone(data.get(key)),compareAndSwap:async(key,version,value)=>{const old=data.get(key);if((old?.version??null)!==version)return false;data.set(key,{version:(old?.version??0)+1,value:structuredClone(value)});return true;}};
 if(pool){const {PostgresAdapter}=await import('../vendor/emradar-v3/src/adapters/postgres.js');adapter=new PostgresAdapter(pool);await adapter.initialize();await adapter.compareAndSwap(id,null,data.get(id).value);}
 const store=new CampaignStore(adapter),workflow=new ReviewWorkflow({store,adapter,notify:async()=>({accepted:true,provider_id:'staging-mail',recipient:'sean@emradar.net',campaign_id:id}),baseUrl:'https://review.example'});
 // Create and consume a real V3 access token; no claimed actor fields.
 const {issueReviewAccess}=await import('../vendor/emradar-v3/src/review-access.js');
 const access=issueReviewAccess({campaignId:id,now:Date.now()});
 data.set('review:'+id,{version:1,value:{...access.record,status:'NOTIFIED'}});
 if(pool)await adapter.compareAndSwap('review:'+id,null,data.get('review:'+id).value);
 const session=await workflow.exchange(id,access.token);
 const audience=createV3AudienceReview({store,loadPublishedBytes:async()=>bytes});workflow.audienceThread=audience;
 const view=()=>workflow.view(id,session.sessionId,session.secret);
 const present=async review=>{await workflow.authenticate(id,session.sessionId,session.secret);await audience.present(id,session.sessionId,{manifest_sha256:review.manifest_sha256,segment_hashes:review.segments.map(s=>s.asset_sha256)});};
 const decide=(review,decision='APPROVE')=>workflow.decide(id,session.sessionId,session.secret,'x',decision,review.manifest_sha256);
 return {id,data,adapter,store,workflow,audience,session,view,present,decide,bytes};
}
test('real V3 session, full scan preview, exact media and persisted approval verification',async()=>{
 const s=await setup(),view=await s.view(),r=view.xThread;
 assert.equal(r.ready,true);assert(r.segments.length>=3);
 const full=r.segments.filter(s=>s.record_id===r.discovery_ids[0]).map(s=>s.text).join(' ');
 for(const value of ['Ownership concerns','Verified free float','BREN (IDX)','Consultation is not a final downgrade.','Reforms accepted','Final decision'])assert(full.includes(value));
 for(const s of r.segments)assert.equal(s.parent_sequence,s.sequence===1?null:s.sequence-1);
 assert(r.segments.some(s=>s.record_id==='copper'));
 await assert.rejects(()=>s.decide(r),/PRESENTATION_REQUIRED/);
 await s.present(r);await s.decide(r);assert.equal(await s.audience.verify({campaign_id:s.id,approved_thread:(await s.view()).xThread}),false); // UI metadata is not a publication manifest.
 assert.equal(await s.audience.verify({campaign_id:s.id}),true);
 assert.equal(s.data.get(s.id).value.audience_x_checks.exact_assets,'PASS');
 assert.deepEqual(s.data.get(s.id).value.decisions,{});assert.deepEqual(s.data.get(s.id).value.deliveries,{});
 const tampered=structuredClone(s.data.get(s.id).value.audience_x_review);tampered.segments[1].source_links=['https://attacker.example'];
 assert.equal(await s.audience.verify({campaign_id:s.id,approved_thread:tampered}),false);
});
test('edits change hashes, archive prior version and invalidate all prior presentation and approval',async()=>{
 const s=await setup(),r=(await s.view()).xThread;
 await s.present(r);await s.decide(r);
 await s.workflow.revise(s.id,s.session.sessionId,s.session.secret,'x',r.manifest_sha256,{sequence:2,text:'Owner clarification. https://example.org/source'});
 const next=(await s.view()).xThread;
 assert.notEqual(next.manifest_sha256,r.manifest_sha256);assert.notEqual(next.segments[1].asset_sha256,r.segments[1].asset_sha256);
 assert.equal(await s.audience.verify({campaign_id:s.id}),false);
 await assert.rejects(()=>s.decide(r),/DECISION_STALE/);await assert.rejects(()=>s.decide(next),/PRESENTATION_REQUIRED/);
 assert.equal(s.data.get(s.id).value.audience_x_history.length,1);
});
test('partial presentation, spoofed owner, changed source and substituted bytes fail closed',async()=>{
 const s=await setup(),r=(await s.view()).xThread;
 await assert.rejects(()=>s.audience.present(s.id,s.session.sessionId,{manifest_sha256:r.manifest_sha256,segment_hashes:[r.segments[0].asset_sha256]}),/PRESENTATION_INCOMPLETE/);
 await assert.rejects(()=>s.workflow.decide(s.id,s.session.sessionId,'spoof','x','APPROVE',r.manifest_sha256),/OWNER_SESSION_REQUIRED/);
 await s.present(r);await s.decide(r);
 s.data.get(s.id).value.audience_x_review.segments[0].media.base64=Buffer.from('substitute').toString('base64');
 assert.equal(await s.audience.verify({campaign_id:s.id}),false);
 const other=await setup();other.workflow.audienceThread=createV3AudienceReview({store:other.store,loadPublishedBytes:async()=>Buffer.from('{}')});
 assert.equal((await other.view()).xThread.ready,false);assert.deepEqual(other.data.get(other.id).value.decisions,{});
});
test('pre-existing decisions and delivered X are preserved without a replacement proposal',async()=>{
 const s=await setup();s.data.get(s.id).value.deliveries.x={status:'ACCEPTED',provider_id:'123'};
 assert.equal((await s.view()).xThread.ready,false);assert.equal(s.data.get(s.id).value.deliveries.x.provider_id,'123');
});
test('PostgreSQL staging: V3 approval, JSONB hashes, exact upload, ambiguous reconciliation and restart without duplicate posts',{skip:!process.env.V3_TEST_DATABASE_URL},async t=>{
 const {Pool}=require('pg'),{ThreadStore}=require('../src/emradar-x-thread-store.cjs'),{createV3ThreadPublication}=require('../src/emradar-audience-v3-publication.cjs'),{createV3X}=require('../src/emradar-v3-x.cjs');
 const pool=new Pool({connectionString:process.env.V3_TEST_DATABASE_URL});t.after(()=>pool.end());
 const s=await setup(pool),r=(await s.view()).xThread;
 console.info('STAGING_X_THREAD_INPUT',JSON.stringify({scan_sha256:hash(s.bytes),discoveries:r.discovery_ids.length,posts:r.segments.length,graphic_sha256:r.segments[0].media?.sha256,provider:'SIMULATED_X_NO_EXTERNAL_DISTRIBUTION'}));
 assert.equal(r.ready,true);await s.present(r);await s.decide(r);assert.equal(await s.audience.verify({campaign_id:s.id}),true);
 const posts=[];let lost=false;
 const fetcher=async(url,options={})=>{
  const body=options.body&&typeof options.body==='string'?JSON.parse(options.body):null;
  let result;
  if(url.includes('/2/users/42/tweets?'))result={meta:{result_count:posts.length},data:posts};
  else if(url.endsWith('/2/media/upload/initialize'))result={data:{id:'900',media_key:'3_900'}};
  else if(url.endsWith('/append')||url.endsWith('/finalize'))result={data:{}};
  else if(url.endsWith('/2/tweets')){
   const post={id:String(1000+posts.length),text:body.text,referenced_tweets:body.reply?[{type:'replied_to',id:body.reply.in_reply_to_tweet_id}]:[],attachments:body.media?{media_keys:['3_900']}:undefined,created_at:new Date().toISOString()};posts.push(post);result={data:{id:post.id}};
   if(posts.length===2&&!lost){lost=true;throw Error('simulated lost accepted response');}
  }else throw Error('unexpected X endpoint');
  return {ok:true,json:async()=>result};
 };
 const x=createV3X({env:{EMRADAR_V3_X_PUBLISH_ENABLED:'true'},fetcher,auth:{current:async()=>({access_token:'staging-only',scope:'tweet.read tweet.write users.read media.write offline.access'}),verifyAccount:async()=>({account_id:'42'})}});
 const threadStore=new ThreadStore(pool);await threadStore.initialize();
 const makeWorker=()=>createV3ThreadPublication({campaignStore:s.store,threadStore:new ThreadStore(pool),review:s.audience,x,enabled:true,maxPostsPerRun:2});
 let result=await makeWorker()(s.id);assert.equal(result.status,'HALTED_AMBIGUOUS');assert.equal(posts.length,2);
 // A newly constructed worker independently reconciles the lost receipt.
 for(let i=0;i<r.segments.length&&result.status!=='COMPLETE';i++)result=await makeWorker()(s.id);
 assert.equal(result.status,'COMPLETE');assert.equal(posts.length,r.segments.length);
 for(const [i,post] of posts.entries()){assert.equal(post.text,r.segments[i].text);assert.equal(post.referenced_tweets[0]?.id??null,i?posts[i-1].id:null);}
 const before=posts.length;assert.equal((await makeWorker()(s.id)).status,'COMPLETE');assert.equal(posts.length,before);
 await assert.rejects(()=>s.workflow.revise(s.id,s.session.sessionId,s.session.secret,'x',r.manifest_sha256,{sequence:2,text:'No edits after start.'}),/REVISION_AFTER_DISTRIBUTION/);
 assert.deepEqual((await s.adapter.read(s.id)).value.deliveries,{});
 await pool.query('DELETE FROM emradar_x_thread_posts WHERE campaign_id=$1',[s.id]);await pool.query('DELETE FROM v3_campaign_state WHERE campaign_id IN ($1,$2)',[s.id,'review:'+s.id]);
});
