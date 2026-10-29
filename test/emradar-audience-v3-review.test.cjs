'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {createV3AudienceReview}=require('../src/emradar-audience-v3-review.cjs');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function setup(){
 const {CampaignStore}=await import('../vendor/emradar-v3/src/state.js');
 const {ReviewWorkflow}=await import('../vendor/emradar-v3/src/review-workflow.js');
 const record={id:'indonesia-equity-market-accessibility-crisis',theme:'Market governance',status:'CONFIRMED',why_surfaced:'A consultation is open.',causal_chain:{world_change:['Index review'],pressure:['Ownership concerns'],bottleneck_or_scarcity:['Verified free float'],formation:['Market governance as access condition'],industries:['Capital markets'],connected_companies_and_tickers:['BREN (IDX)'],consequences:['Potential outflows']},contradictions:['Consultation is not a final downgrade.'],chain_evolution:{unresolved_evidence:['Final decision'],break_conditions:['Reforms accepted']},evidence:[{fact:'Consultation launched',date:'2026-10-15',url:'https://example.org/evidence'}]};
 const document={publication_state:'PUBLISHED',snapshot_date:'2026-10-17',records:[record,{...record,id:'copper',status:'INVESTIGATE'}]};
 const bytes=Buffer.from(JSON.stringify(document)),digest=hash(bytes),id='staging-campaign';
 const sharp=require('sharp'),png=await sharp({create:{width:40,height:40,channels:3,background:'#164258'}}).png().toBuffer();
 const asset={kind:'X',destination_id:'x',campaign_id:id,body:'Consultation is not a final downgrade.',visual_base64:png.toString('base64'),visual_sha256:hash(png),visual_mime:'image/png'};
 const data=new Map([[id,{version:1,value:{id,phase:'PUBLICATION_REVIEW',scan:{snapshot_date:document.snapshot_date,artifact_sha256:digest,source_key:document.snapshot_date+':'+digest},assets:{x:{asset,fingerprint:'legacy'}},destinations:[{id:'x'}],decisions:{},deliveries:{},events:[],preparation_input:{document}}}]]);
 const adapter={read:async key=>structuredClone(data.get(key)),compareAndSwap:async(key,version,value)=>{const old=data.get(key);if((old?.version??null)!==version)return false;data.set(key,{version:(old?.version??0)+1,value:structuredClone(value)});return true;}};
 const store=new CampaignStore(adapter),workflow=new ReviewWorkflow({store,adapter,notify:async()=>({accepted:true,provider_id:'staging-mail',recipient:'sean@emradar.net',campaign_id:id}),baseUrl:'https://review.example'});
 // Create and consume a real V3 access token; no claimed actor fields.
 const {issueReviewAccess}=await import('../vendor/emradar-v3/src/review-access.js');
 const access=issueReviewAccess({campaignId:id,now:Date.now()});
 data.set('review:'+id,{version:1,value:{...access.record,status:'NOTIFIED'}});
 const session=await workflow.exchange(id,access.token);
 const audience=createV3AudienceReview({store,loadPublishedBytes:async()=>bytes});workflow.audienceThread=audience;
 const view=()=>workflow.view(id,session.sessionId,session.secret);
 const present=async review=>{await workflow.authenticate(id,session.sessionId,session.secret);await audience.present(id,session.sessionId,{manifest_sha256:review.manifest_sha256,segment_hashes:review.segments.map(s=>s.asset_sha256)});};
 const decide=(review,decision='APPROVE')=>workflow.decide(id,session.sessionId,session.secret,'x',decision,review.manifest_sha256);
 return {id,data,adapter,store,workflow,audience,session,view,present,decide,bytes};
}
test('real V3 session, full scan preview, exact media and persisted approval verification',async()=>{
 const s=await setup(),view=await s.view(),r=view.xThread;
 assert.equal(r.ready,true);assert.equal(r.segments.length,3);
 for(const value of ['Ownership concerns','Verified free float','BREN (IDX)','Consultation is not a final downgrade.','Reforms accepted','Final decision'])assert(r.segments[1].text.includes(value));
 assert.equal(r.segments[2].parent_sequence,2);assert.equal(r.segments[2].record_id,'copper');
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
 await s.workflow.revise(s.id,s.session.sessionId,s.session.secret,'x',r.manifest_sha256,{sequence:2,text:r.segments[1].text+'\nOwner clarification.'});
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
