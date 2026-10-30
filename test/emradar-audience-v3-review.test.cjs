'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {createV3AudienceReview}=require('../src/emradar-audience-v3-review.cjs');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function setup(pool=null,threadMode='FULL_EVIDENCE'){
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
 const audience=createV3AudienceReview({store,loadPublishedBytes:async()=>bytes,threadMode});workflow.audienceThread=audience;
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
 assert.equal((await s.view()).xThread,null);assert.equal(s.data.get(s.id).value.deliveries.x.provider_id,'123');
});
test('explicit discovery exclusion is bound to the new manifest and invalidates prior approval',async()=>{
 const s=await setup(),r=(await s.view()).xThread;await s.present(r);await s.decide(r);
 await s.workflow.revise(s.id,s.session.sessionId,s.session.secret,'x',r.manifest_sha256,{exclude_record_id:'copper'});
 const next=(await s.view()).xThread;assert(next.ready);assert.deepEqual(next.excluded_discovery_ids,['copper']);assert.deepEqual(next.discovery_ids,[r.discovery_ids[0]]);assert(!next.segments.some(s=>s.record_id==='copper'));
 assert.equal(await s.audience.verify({campaign_id:s.id}),false);await s.present(next);await s.decide(next);assert.equal(await s.audience.verify({campaign_id:s.id}),true);
});
test('graphic edits accept only exact saved V3 bytes and invalidate the prior canonical approval',async()=>{
 const s=await setup(),r=(await s.view()).xThread;await s.present(r);await s.decide(r);
 const png=await require('sharp')({create:{width:40,height:40,channels:3,background:'#fedcba'}}).png().toBuffer(),state=s.data.get(s.id).value;
 const asset={...state.assets.x.asset,visual_base64:png.toString('base64'),visual_sha256:hash(png)};state.editorial_versions={x:[{asset}]};
 await assert.rejects(()=>s.workflow.revise(s.id,s.session.sessionId,s.session.secret,'x',r.manifest_sha256,{sequence:1,graphic_sha256:'untrusted'}),/TRUSTED_GRAPHIC_REQUIRED/);
 await s.workflow.revise(s.id,s.session.sessionId,s.session.secret,'x',r.manifest_sha256,{sequence:1,graphic_sha256:asset.visual_sha256});
 const next=(await s.view()).xThread;assert.notEqual(next.manifest_sha256,r.manifest_sha256);assert.equal(next.segments[0].media.sha256,asset.visual_sha256);assert.equal(next.graphic_choices.length,2);assert.equal(await s.audience.verify({campaign_id:s.id}),false);
 await s.present(next);await s.decide(next);assert.equal(await s.audience.verify({campaign_id:s.id}),true);
});
test('a hash-matching but undecodable graphic cannot be presented or approved',async()=>{
 const s=await setup(),asset=s.data.get(s.id).value.assets.x.asset,bytes=Buffer.from(asset.visual_base64,'base64'),offset=bytes.indexOf(Buffer.from('IDAT'))+8;bytes[offset]^=255;
 asset.visual_base64=bytes.toString('base64');asset.visual_sha256=hash(bytes);
 const r=(await s.view()).xThread;assert.equal(r.ready,false);assert(r.segments.length>0);assert(r.problems.includes('GRAPHIC_DECODE_FAILED'));
 await assert.rejects(()=>s.present(r),/GRAPHIC_DECODE_FAILED/);await assert.rejects(()=>s.decide(r),/GRAPHIC_DECODE_FAILED/);
 assert.equal(s.data.get(s.id).value.audience_x_approval,undefined);
});
test('PostgreSQL staging: V3 approval, JSONB hashes, exact upload, ambiguous reconciliation and restart without duplicate posts',{skip:!process.env.V3_TEST_DATABASE_URL},async t=>{
 const {Pool}=require('pg'),{ThreadStore}=require('../src/emradar-x-thread-store.cjs'),{createV3ThreadPublication}=require('../src/emradar-audience-v3-publication.cjs'),{createV3X}=require('../src/emradar-v3-x.cjs');
 const pool=new Pool({connectionString:process.env.V3_TEST_DATABASE_URL});let cleanupId;
 t.after(async()=>{if(cleanupId){await pool.query('DELETE FROM emradar_x_thread_posts WHERE campaign_id=$1',[cleanupId]).catch(()=>{});await pool.query('DELETE FROM v3_campaign_state WHERE campaign_id IN ($1,$2)',[cleanupId,'review:'+cleanupId]).catch(()=>{});}await pool.end();});
 const s=await setup(pool),r=(await s.view()).xThread;
 cleanupId=s.id;
 console.info('STAGING_X_THREAD_INPUT',JSON.stringify({scan_sha256:hash(s.bytes),discoveries:r.discovery_ids.length,posts:r.segments.length,graphic_sha256:r.segments[0].media?.sha256,provider:'SIMULATED_X_NO_EXTERNAL_DISTRIBUTION'}));
 assert.equal(r.ready,true);await s.present(r);await s.decide(r);assert.equal(await s.audience.verify({campaign_id:s.id}),true);
 const posts=[],basePostId=BigInt(Date.now())*1000000n+BigInt(require('node:crypto').randomInt(1000000));let lost=false;
 const fetcher=async(url,options={})=>{
  const body=options.body&&typeof options.body==='string'?JSON.parse(options.body):null;
  let result;
  if(url.includes('/2/users/42/tweets?'))result={meta:{result_count:posts.length},data:posts};
  else if(url.endsWith('/2/media/upload/initialize'))result={data:{id:'900',media_key:'3_900'}};
  else if(url.endsWith('/append')){assert.equal(hash(Buffer.from(await options.body.get('media').arrayBuffer())),r.segments[0].media.sha256);result={data:{}};}
  else if(url.endsWith('/finalize'))result={data:{}};
  else if(url.endsWith('/2/tweets')){
   const post={id:String(basePostId+BigInt(posts.length)),text:body.text,referenced_tweets:body.reply?[{type:'replied_to',id:body.reply.in_reply_to_tweet_id}]:[],attachments:body.media?{media_keys:['3_900']}:undefined,created_at:new Date().toISOString()};posts.push(post);result={data:{id:post.id}};
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
 const {createFullScanResearch}=require('../src/emradar-grok-full-scan.cjs');let researchCalls=0;
 const research=createFullScanResearch({store:s.store,loadPublishedBytes:async()=>s.bytes,loadPublicationRows:id=>threadStore.list(id),enabled:true,maxSpendUsd:1,requestReserveUsd:0.1,providerSpendLimitVerified:true,pilot:{model:'staging-model-'+s.id,research:async input=>{
  researchCalls++;const id=input.discovery.record_id,url='https://x.com/staging_research/status/987';
  assert.deepEqual(input.discovery.record,JSON.parse(s.bytes).records.find(r=>r.id===id));
  const report={discovery_id:id,keywords:['constraint'],alternative_phrases:['emerging formation'],topic_clusters:['industry pressure'],opportunities:[{type:'REPLY',url,rationale:'Simulated cited research, not a live conversation verification.',evidence_ids:[id+':0'],draft_text:'What evidence would resolve this uncertainty?',scores:{relevance:5,credibility:4,recency:3,engagement:2,fit:5}}]};
  return {model:'staging-model',report:{id:'staging-'+researchCalls,status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(report),annotations:[{type:'url_citation',url}]}]}],usage:{cost_in_usd_ticks:10000000,total_tokens:100,server_side_tool_usage_details:{x_search_calls:1,x_posts_fetched:1,x_users_fetched:0}}}};
 }}});
 let audience;for(let i=0;i<r.all_discovery_ids.length;i++){audience=await research(s.id);if(audience.status==='COMPLETE')break;}
 assert.equal(audience.status,'COMPLETE');assert.equal(researchCalls,r.all_discovery_ids.length);assert.equal((await research(s.id)).outbound_actions,0);assert.equal(researchCalls,r.all_discovery_ids.length);
 console.info('STAGING_FULL_SCAN_RESEARCH',JSON.stringify({...audience,provider:'SIMULATED_GROK_NO_LIVE_RESEARCH'}));
 const saved=(await s.adapter.read(s.id)).value.audience_x_research;assert.equal(saved.opportunities.length,1);assert.equal(saved.opportunities[0].discovery_ids.length,r.all_discovery_ids.length);assert.equal(saved.public_action_policy,'DISABLED');
 await pool.query('DELETE FROM emradar_x_thread_posts WHERE campaign_id=$1',[s.id]);await pool.query('DELETE FROM v3_campaign_state WHERE campaign_id IN ($1,$2)',[s.id,'review:'+s.id]);
});

test('concise V3 review retains one segment per discovery, exact graphic and authenticated approval',async()=>{
 const s=await setup(null,'CONCISE'),r=(await s.view()).xThread;
 assert.equal(r.ready,true,JSON.stringify(r.problems));
 assert.equal(r.segments.length,3);
 assert.deepEqual(r.segments.map(x=>x.record_id),[null,...r.discovery_ids]);
 assert(r.segments[0].media?.sha256);
 assert(r.segments.every(x=>x.discovery_parts===1));
 await assert.rejects(()=>s.decide(r),/PRESENTATION_REQUIRED/);
 await s.present(r);await s.decide(r);
 assert.equal(await s.audience.verify({campaign_id:s.id}),true);
 assert.deepEqual(s.data.get(s.id).value.decisions,{});
 assert.deepEqual(s.data.get(s.id).value.deliveries,{});
 const tampered=structuredClone(s.data.get(s.id).value.audience_x_review);
 tampered.segments[1].text+=' altered';
 assert.equal(await s.audience.verify({campaign_id:s.id,approved_thread:tampered}),false);
 await s.workflow.revise(s.id,s.session.sessionId,s.session.secret,'x',r.manifest_sha256,{sequence:2,text:'Corrected discovery. https://example.org/evidence'});
 assert.equal(await s.audience.verify({campaign_id:s.id}),false);
 const revised=(await s.view()).xThread;
 assert.equal(revised.segments.length,3);
 await assert.rejects(()=>s.decide(revised),/PRESENTATION_REQUIRED/);
 await s.present(revised);await s.decide(revised);
 assert.equal(await s.audience.verify({campaign_id:s.id}),true);
});
