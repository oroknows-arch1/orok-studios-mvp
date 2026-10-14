'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {mountV3PreparationReview,loadPublishedScans,runNextPublishedCampaign,runReleaseOnce}=require('../src/emradar-v3-runtime.cjs');
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
test('activation initializes V3 tables and exposes preparation plus owner-notification only',async()=>{
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
 assert.deepEqual(routes.map(r=>r[0]),['/emradar/v3/owner-notification','/emradar/v3/discover','/emradar/v3/prepare']);
 assert.equal(sql.length,4);
 assert.equal(handlers.length,1);
 assert(sql.every(q=>q.includes('CREATE TABLE IF NOT EXISTS v3_')));
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
  discover:async({scan})=>events.push('discover:'+scan.snapshot_date),
  prepareAndNotify:async selected=>{events.push('prepare:'+selected.snapshotDate);return {campaignId:'campaign-12',status:'PUBLICATION_REVIEW',notification:'NOTIFIED'};}
 });
 assert.deepEqual(events,['start:2026-10-12','discover:2026-10-12','prepare:2026-10-12']);
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
