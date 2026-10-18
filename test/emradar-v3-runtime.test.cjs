'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {mountV3PreparationReview,loadPublishedScans,runNextPublishedCampaign,runReleaseOnce,runIncompleteCampaignRecovery}=require('../src/emradar-v3-runtime.cjs');
test('disabled runtime is inert and registers no sending routes',async()=>{
 const routes=[];
 assert.deepEqual(await mountV3PreparationReview({app:{post:(...args)=>routes.push(args)},env:{}}),{enabled:false});
 assert.deepEqual(routes,[]);
});
test('activation refuses missing configuration before connecting',async()=>{
 let connected=false;
 await assert.rejects(mountV3PreparationReview({
  app:{post:()=>{}},env:{EMRADAR_V3_PREPARATION_ENABLED:'true'},
  createPool:()=>{connected=true;return {};}
 }),/V3_ACTIVATION_CONFIG_REQUIRED/);
 assert.equal(connected,false);
});
test('activation initializes V3 tables and exposes preparation plus guarded release routes',async()=>{
 const routes=[],sql=[],handlers=[];
 const pool={query:async q=>{sql.push(q);return {rows:[],rowCount:0};},end:async()=>{}};
 const env={EMRADAR_V3_PREPARATION_ENABLED:'true',EMRADAR_V3_DATABASE_URL:'postgres://example.invalid/db',EMRADAR_V3_API_TOKEN:'t'.repeat(40),EMRADAR_V3_REVIEW_ORIGIN:'https://review.example.org'};
 const result=await mountV3PreparationReview({
  app:{post:(...args)=>routes.push(args)},env,createPool:()=>pool,
  openai:{chat:{completions:{create:async()=>({})}},images:{generate:async()=>({})}},
  setReviewHandler:handler=>handlers.push(handler)
 });
 assert.equal(result.enabled,true);
 assert.equal(typeof result.runCampaign,'function');
 assert.deepEqual(routes.map(r=>r[0]),['/emradar/v3/owner-notification','/emradar/v3/release-email','/emradar/v3/discover','/emradar/v3/prepare']);
 const createSql=sql.filter(q=>q.includes('CREATE TABLE IF NOT EXISTS v3_'));
 assert(createSql.length>=7);
 assert.equal(handlers.length,1);
 for(const table of ['v3_campaign_state','v3_outlet_directory','v3_contact_research','v3_send_reservations','v3_owner_notification_reservations','v3_x_authorization','v3_x_oauth_states'])assert(createSql.some(q=>q.includes(table)));
});
test('selects newest unprocessed published scan and runs discovery before preparation',async()=>{
 const published=loadPublishedScans();
 assert.deepEqual(published.slice(0,2).map(item=>item.snapshotDate),['2026-10-13','2026-10-12']);
 const events=[];
 const result=await runNextPublishedCampaign({
  published,
  readCampaign:async id=>id.includes('ceed5baef2b572435917a9cdfab7b864')?{phase:'PUBLICATION_REVIEW'}:null,
  verify:async selected=>({scan:{snapshot_date:selected.snapshotDate},document:{evidence:[]}}),
  startCampaign:async scan=>{events.push('start:'+scan.snapshot_date);return 'campaign-12';},
  discover:async({scan})=>{events.push('discover:'+scan.snapshot_date);return [{id:'x'}];},
  persistDestinations:async(_campaignId,destinations)=>events.push('persist:'+destinations.length),
  prepareAndNotify:async selected=>{events.push('prepare:'+selected.snapshotDate);return {campaignId:'campaign-12',status:'PUBLICATION_REVIEW',notification:'NOTIFIED'};}
 });
 assert.deepEqual(events,['start:2026-10-12','discover:2026-10-12','persist:1','prepare:2026-10-12']);
 assert.deepEqual(result,{campaignId:'campaign-12',status:'PUBLICATION_REVIEW',notification:'NOTIFIED',snapshotDate:'2026-10-12',discovery:'COMPLETE'});
});
test('release execution is durably claimed and cannot advance on restart',async()=>{
 let record=null,runs=0;
 const adapter={compareAndSwap:async(_key,version,value)=>{
  if(version===null){if(record)return false;record={version:1,value};return true;}
  if(record?.version!==version)return false;record={version:version+1,value};return true;
 }};
 const first=await runReleaseOnce({adapter,key:'release',run:async()=>{runs++;return {status:'PUBLICATION_REVIEW'};}});
 const second=await runReleaseOnce({adapter,key:'release',run:async()=>{runs++;return {status:'SHOULD_NOT_RUN'};}});
 assert.equal(first.status,'PUBLICATION_REVIEW');
 assert.equal(second.status,'RELEASE_ALREADY_EXECUTED');
 assert.equal(runs,1);
 assert.equal(record.value.status,'COMPLETE');
});
test('complete historical checkpoint recovers incomplete persisted campaign exactly once',async()=>{
 let checkpoint=null,resumes=0,notifications=0,complete=false;
 const adapter={compareAndSwap:async(_key,version,value)=>{if(version===null){if(checkpoint)return false;checkpoint={version:1,value};return true;}if(checkpoint?.version!==version)return false;checkpoint={version:version+1,value};return true;}};
 const service={reviewCompletion:async()=>complete?{complete:true,verified_publications:2,editorial_emails:2,x_ready:true,missing_destination_ids:[]}:{complete:false,verified_publications:0,editorial_emails:0,x_ready:true,missing_destination_ids:[]},resumeIntelligentDiscovery:async()=>{resumes++;complete=true;return {campaignId:'campaign',status:'PUBLICATION_REVIEW',editorial_drafts:2};},workflow:{issue:async()=>{notifications++;return {status:'NOTIFIED'};}}};
 const first=await runIncompleteCampaignRecovery({adapter,service,campaignId:'campaign',key:'recovery'});
 const second=await runIncompleteCampaignRecovery({adapter,service,campaignId:'campaign',key:'recovery'});
 assert.equal(first.complete,true);assert.equal(first.recovery,'COMPLETE');assert.equal(checkpoint.value.status,'COMPLETE');
 assert.equal(second.recovery,'ALREADY_COMPLETE');assert.equal(resumes,1);assert.equal(notifications,1);
});
test('incomplete persisted recovery never records a false COMPLETE checkpoint',async()=>{
 let checkpoint=null;
 const adapter={compareAndSwap:async(_key,version,value)=>{if(version===null){checkpoint={version:1,value};return true;}checkpoint={version:version+1,value};return true;}};
 const incomplete={complete:false,verified_publications:1,editorial_emails:0,x_ready:true,missing_destination_ids:['missing']};
 const service={reviewCompletion:async()=>incomplete,resumeIntelligentDiscovery:async()=>({status:'PUBLICATION_REVIEW'}),workflow:{issue:async()=>{throw Error('MUST_NOT_NOTIFY');}}};
 await assert.rejects(runIncompleteCampaignRecovery({adapter,service,campaignId:'campaign',key:'recovery'}),/V3_PUBLICATION_REVIEW_INCOMPLETE/);
 assert.equal(checkpoint.value.status,'STARTED');
});
test('daily refresh detects October 15 without bundled attestations and verifies archive identity',async()=>{
 const {refreshPublishedScans,campaignIdFor}=require('../src/emradar-v3-runtime.cjs');
 const {verifyPublishedScan}=await import('../vendor/emradar-v3/src/scan-intake.js');
 const bytes=Buffer.from(JSON.stringify({snapshot_date:'2026-10-15',publication_state:'PUBLISHED',evidence:[]}));
 const fetcher=async()=>({ok:true,arrayBuffer:async()=>bytes});
 const [scan]=await refreshPublishedScans({fetcher});
 const verified=await verifyPublishedScan({...scan,fetcher});
 assert.equal(verified.scan.snapshot_date,'2026-10-15');
 assert.equal(campaignIdFor(scan),'v3-'+require('node:crypto').createHash('sha256').update(verified.scan.source_key).digest('hex').slice(0,32));
 const next=await require('../src/emradar-v3-runtime.cjs').selectNextPublishedScan({published:[scan,...loadPublishedScans()],readCampaign:async id=>id===campaignIdFor(scan)?null:{phase:'DESTINATIONS_SELECTED'}});
 assert.equal(next.snapshotDate,'2026-10-15');
 await assert.rejects(verifyPublishedScan({...scan,fetcher:async()=>({ok:true,arrayBuffer:async()=>Buffer.from('{}')})}),/UNVERIFIED_PUBLICATION/);
 await assert.rejects(refreshPublishedScans({fetcher:async()=>({ok:true,arrayBuffer:async()=>Buffer.from('{"snapshot_date":"2026-10-15","publication_state":"DRAFT"}')})}),/SCAN_NOT_PUBLISHED/);
});
