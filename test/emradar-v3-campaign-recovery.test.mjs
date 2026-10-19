import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import verified from './fixtures/v3-verified-recipient.cjs';
import {createPreparationReviewService} from '../vendor/emradar-v3/src/preparation-review-service.js';

async function harness({count=10,failAfter=null,replaceVisual=false}={}){
 const evidence=[{id:'e1',record_id:'r1',verified:true,fact:'An industrial project was proposed.',source_url:'https://source.example/fact'}];
 const document={snapshot_date:'2026-10-17',publication_state:'PUBLISHED',evidence};
 const bytes=Buffer.from(JSON.stringify(document)),digest=createHash('sha256').update(bytes).digest('hex');
 const id='v3-'+createHash('sha256').update('2026-10-17:'+digest).digest('hex').slice(0,32);
 const input={snapshotDate:'2026-10-17',expectedSha256:digest,liveUrl:'https://emerging-markets-radar.onrender.com/data/current.json',archiveUrl:'https://emerging-markets-radar.onrender.com/data/archive.json'};
 const x={asset:{campaign_id:id,destination_id:'x',kind:'X',body:'Saved X text',visual_url:'data:image/png;base64,keep',visual_sha256:'a'.repeat(64),evidence_ids:['e1']},fingerprint:'keep-approved-x'};
 const state={id,scan:{snapshot_date:'2026-10-17',artifact_sha256:digest,source_key:'2026-10-17:'+digest},phase:'PUBLICATION_REVIEW',destinations:[{id:'x'}],assets:{x},decisions:{x:{decision:'REJECT',asset_sha256:x.fingerprint}},deliveries:{},events:[{type:'SCAN_VERIFIED'}],preparation_input:{document}};
 if(replaceVisual)state.decisions={};
 const records=new Map([[id,{version:1,payload:state}]]),directory=new Map();let searches=0,writes=0,notifications=0,images=0,fail=failAfter;
 const pool={query:async(sql,args=[])=>{
  if(sql.startsWith('CREATE '))return {rows:[]};
  if(sql.startsWith('SELECT version')){const row=records.get(args[0]);return {rows:row?[structuredClone(row)]:[]};}
  if(sql.startsWith('UPDATE v3_campaign_state')){const row=records.get(args[0]);if(row?.version!==args[1])return {rowCount:0};records.set(args[0],{version:row.version+1,payload:JSON.parse(args[2])});return {rowCount:1};}
  if(sql.startsWith('INSERT INTO v3_campaign_state')){if(records.has(args[0]))return {rowCount:0};records.set(args[0],{version:1,payload:JSON.parse(args[1])});return {rowCount:1};}
  if(sql.startsWith('SELECT record FROM v3_outlet_directory WHERE'))return {rows:[...directory.values()].filter(d=>d.contact.email===args[0]&&d.id!==args[1]).map(record=>({record}))};
  if(sql.startsWith('SELECT record FROM v3_outlet_directory'))return {rows:[...directory.values()].map(record=>({record}))};
  if(sql.startsWith('INSERT INTO v3_outlet_directory')){directory.set(args[0],JSON.parse(args[1]));return {rowCount:1};}
  throw Error('UNEXPECTED_SQL');
 }};
 let service;
 service=await createPreparationReviewService({pool,reviewOrigin:'https://review.example',reviewedLinks:[],fetcher:async()=>({ok:true,arrayBuffer:async()=>bytes}),researchEvidence:async()=>{throw Error('NO_RESEARCH_REPEAT');},renderVisual:async()=>{if(!replaceVisual)throw Error('NO_X_REGENERATION');images++;return {base64:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jq1sAAAAASUVORK5CYII=',brand_version:'emradar-formation-card-v1'};},write:async({campaignId,destination})=>{
  if(fail!==null&&writes>=fail)throw Error('PROVIDER_UNAVAILABLE');writes++;
  return {campaign_id:campaignId,destination_id:destination.id,kind:'EMAIL',subject:'Research contribution',body:'A sourced proposal for '+destination.name+'. Would an article interest you?',from:'sean@emradar.net',to:destination.contact.email,contact_status:'VERIFIED',delivery_eligible:true,evidence_ids:['e1']};
 },notify:async({campaignId,recipient})=>{notifications++;return {accepted:true,provider_id:'owner-invitation',campaign_id:campaignId,recipient};},discoverLinks:async()=>{
  searches++;
  for(let n=0;n<count;n++)await service.directory.upsert(verified('publication-'+n,evidence));
  return [...directory.keys()].map(outlet_id=>({approved:true,outlet_id,evidence_id:'e1'}));
 }});
 return {id,input,service,records,directory,original:structuredClone(state),metrics:()=>({searches,writes,notifications}),imageCount:()=>images,restore:()=>{fail=null;}};
}
test('October 17 existing campaign recovers discovery, saved destinations, ten personalised emails and one owner invitation without regenerating X',async()=>{
 const f=await harness();const result=await f.service.prepareAndNotify(f.input);
 assert.equal(result.campaignId,f.id);assert.equal(result.status,'PUBLICATION_REVIEW');
 const state=f.records.get(f.id).payload;assert.equal(state.destinations.length,11);assert.equal(Object.keys(state.assets).length,11);assert.equal(state.review_completion.complete,true);
 assert.deepEqual(state.assets.x,f.original.assets.x);assert.deepEqual(state.decisions,f.original.decisions);assert.deepEqual(state.deliveries,{});
 assert.deepEqual(f.metrics(),{searches:1,writes:10,notifications:1});assert.equal(f.directory.size,10);
 await f.service.prepareAndNotify(f.input);assert.deepEqual(f.metrics(),{searches:1,writes:10,notifications:1});
 assert.equal([...f.records.keys()].filter(k=>k.startsWith('v3-')).length,1);
});
test('Run Discovery completes persistence, attachment and notification rather than only refreshing the directory',async()=>{
 const f=await harness({count:12});const result=await f.service.resumeIntelligentDiscovery(f.id);
 assert.equal(result.complete,true);assert.equal(result.editorial_drafts,12);assert.equal(result.notification,'NOTIFIED');
 await f.service.resumeIntelligentDiscovery(f.id);assert.equal(f.metrics().writes,12);assert.equal(f.metrics().notifications,1);
});
test('no verified contact still creates review while delivery remains approval-gated',async()=>{
 const f=await harness({count:0});const result=await f.service.prepareAndNotify(f.input);assert.equal(result.status,'PUBLICATION_REVIEW');
 const state=f.records.get(f.id).payload;assert.equal(state.phase,'PUBLICATION_REVIEW');assert.equal(state.review_completion.complete,true);assert.deepEqual(state.assets.x,f.original.assets.x);assert.equal(f.metrics().notifications,1);
 await assert.rejects(f.service.store.claimDelivery(f.id,'x'),/OWNER_APPROVAL_REQUIRED/);
});
test('provider interruption preserves ready work and exposes failed items without suppressing review',async()=>{
 const f=await harness({count:3,failAfter:1});const result=await f.service.prepareAndNotify(f.input);assert.equal(result.status,'PUBLICATION_REVIEW');
 const state=f.records.get(f.id).payload;assert.equal(state.phase,'PUBLICATION_REVIEW');assert.equal(Object.keys(state.assets).length,4);assert.equal(f.metrics().notifications,1);
 f.service.workflow.authenticate=async()=>true;const review=await f.service.workflow.view(f.id);assert.equal(review.entries.length,4);assert.equal(review.entries.filter(entry=>entry.asset.review_status==='NEEDS_REVISION').length,2);
 assert.deepEqual(state.assets.x,f.original.assets.x);assert.deepEqual(state.decisions,f.original.decisions);
});

test('one unreviewed X graphic is branded, the old graphic is retained, and restart never generates another post or image',async()=>{
 const f=await harness({count:2,replaceVisual:true});await f.service.prepareAndNotify(f.input);
 const state=f.records.get(f.id).payload;assert.equal(f.imageCount(),1);assert.equal(state.assets.x.asset.body,f.original.assets.x.asset.body);assert.equal(state.assets.x.asset.visual_brand_version,'emradar-formation-card-v1');assert.deepEqual(state.editorial_versions.x[0],f.original.assets.x);assert.deepEqual(state.decisions,{});
 await f.service.prepareAndNotify(f.input);assert.equal(f.imageCount(),1);assert.equal(Object.values(state.assets).filter(entry=>entry.asset.kind==='X').length,1);
});

test('explicit research-only recovery completes drafts without sending an owner invitation',async()=>{
 const f=await harness({count:3});const result=await f.service.resumeIntelligentDiscovery(f.id,{notifyOwner:false});
 assert.equal(result.complete,true);assert.equal(result.notification,'NOT_REQUESTED');assert.equal(f.metrics().notifications,0);assert.equal(f.records.has('review:'+f.id),false);assert.deepEqual(f.records.get(f.id).payload.assets.x,f.original.assets.x);
});
