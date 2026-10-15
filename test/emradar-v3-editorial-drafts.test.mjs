import test from 'node:test';
import assert from 'node:assert/strict';
import {CampaignStore} from '../vendor/emradar-v3/src/state.js';
import {assertSendable,sha256} from '../vendor/emradar-v3/src/contracts.js';
import {assessPublicationReview,selectPersistedDraftDestinations} from '../vendor/emradar-v3/src/preparation-review-service.js';

const evidence=[{id:'e1',verified:true,fact:'Verified fact',source_url:'https://source.example/fact'}];
const scanDigest=sha256(JSON.stringify(evidence.map(item=>[item.id,item.fact,item.source_url])));

test('reuses persisted evidence-linked publication as a clearly unverified draft destination',()=>{
 const selected=selectPersistedDraftDestinations({document:{evidence},existingIds:['x'],candidates:[{id:'journal',name:'Journal',category:'news',destination_class:'EDITORIAL_PUBLICATION',active:true,contact_verified:false,editorial_fit_verified:true,contact:{email:null},verification:{evidence_ids:['e1'],scan_evidence_digest:scanDigest}}]});
 assert.deepEqual(selected,[{id:'journal',name:'Journal',category:'news',destination_class:'EDITORIAL_PUBLICATION',relationship:undefined,contact:null,evidence:{ids:['e1']},contact_verified:false,editorial_fit_verified:true,delivery_eligible:false,contact_status:'UNVERIFIED',draft_only:true}]);
});

test('does not turn a legacy source institution into an editorial draft destination',()=>{
 const selected=selectPersistedDraftDestinations({document:{evidence},existingIds:['x'],candidates:[{id:'source',name:'Source',category:'research',active:true,verification:{evidence_ids:['e1'],scan_evidence_digest:scanDigest}}]});
 assert.deepEqual(selected,[]);
});

test('adds draft to existing X review without changing X, decisions or delivery state',async()=>{
 let value={id:'campaign',phase:'PUBLICATION_REVIEW',destinations:[{id:'x',contact_verified:true,evidence:{ids:['e1']}}],assets:{x:{asset:{campaign_id:'campaign',destination_id:'x',kind:'X',body:'x',evidence_ids:['e1']},fingerprint:'kept'}},decisions:{x:{decision:'APPROVE'}},deliveries:{},events:[]};
 let version=1;
 const adapter={read:async()=>({version,value}),compareAndSwap:async(_id,expected,next)=>{if(expected!==version)return false;version++;value=next;return true;}};
 const store=new CampaignStore(adapter);
 const destination={id:'journal',name:'Journal',category:'news',contact:null,evidence:{ids:['e1']},contact_verified:false,editorial_fit_verified:false,delivery_eligible:false,contact_status:'UNVERIFIED',draft_only:true};
 const asset={campaign_id:'campaign',destination_id:'journal',kind:'EMAIL',subject:'Draft',body:'Body',from:'sean@emradar.net',to:null,contact_status:'UNVERIFIED',delivery_eligible:false,evidence_ids:['e1']};
 await store.extendReview('campaign',[destination],[asset]);
 assert.equal(value.phase,'PUBLICATION_REVIEW');
 assert.equal(value.assets.x.fingerprint,'kept');
 assert.equal(value.decisions.x.decision,'APPROVE');
 assert.equal(value.assets.journal.asset.contact_status,'UNVERIFIED');
 assert.throws(()=>assertSendable({asset,approval:{}}),/VERIFIED_DELIVERY_DETAILS_REQUIRED/);
});

test('persisted completion requires every verified publication email and X graphic',()=>{
 const publication=id=>({id,destination_class:'EDITORIAL_PUBLICATION',active:true,editorial_fit_verified:true,verification:{status:'VERIFIED',evidence_ids:['e1'],scan_evidence_digest:scanDigest}});
 const state={phase:'PUBLICATION_REVIEW',preparation_input:{document:{evidence}},destinations:[{id:'x'},{id:'one'}],assets:{x:{asset:{destination_id:'x',kind:'X',body:'text',visual_url:'data:image/png;base64,AA'}},one:{asset:{destination_id:'one',kind:'EMAIL',body:'email'}}}};
 assert.deepEqual(assessPublicationReview({state,candidates:[publication('one'),publication('two')]}),{complete:false,verified_publications:2,editorial_emails:1,x_ready:true,missing_destination_ids:['two']});
 state.destinations.push({id:'two'});state.assets.two={asset:{destination_id:'two',kind:'EMAIL',body:'email'}};
 assert.deepEqual(assessPublicationReview({state,candidates:[publication('one'),publication('two')]}),{complete:true,verified_publications:2,editorial_emails:2,x_ready:true,missing_destination_ids:[]});
});

test('restart completes verified publication drafts before invitation, preserving saved X and excluding failed proof',async()=>{
 const {createPreparationReviewService}=await import('../vendor/emradar-v3/src/preparation-review-service.js');
 const {createHash}=await import('node:crypto');
 const bytes=Buffer.from(JSON.stringify({snapshot_date:'2026-10-15',publication_state:'PUBLISHED',evidence}));
 const hash=createHash('sha256').update(bytes).digest('hex');
 const id='v3-'+sha256('2026-10-15:'+hash).slice(0,32);
 const records=new Map([[id,{version:1,payload:{id,scan:{snapshot_date:'2026-10-15',artifact_sha256:hash,source_key:'2026-10-15:'+hash},phase:'PUBLICATION_REVIEW',preparation_input:{document:{evidence}},destinations:[{id:'x'}],assets:{x:{asset:{campaign_id:id,destination_id:'x',kind:'X',body:'Saved X',visual_url:'saved-image',visual_sha256:'a'.repeat(64)},fingerprint:'saved-fingerprint'}},decisions:{},deliveries:{},events:[]}}]]);
 const outlets=['VERIFIED','UNVERIFIED'].map((status,i)=>({id:'journal'+i,name:'Journal '+i,category:'news',destination_class:'EDITORIAL_PUBLICATION',active:true,editorial_fit_verified:true,contact_verified:false,verification:{status,evidence_ids:['e1'],scan_evidence_digest:scanDigest}}));
 const pool={query:async(sql,args=[])=>{
  if(sql.includes('CREATE TABLE'))return {rows:[]};
  if(sql.startsWith('SELECT record'))return {rows:outlets.map(record=>({record}))};
  if(sql.startsWith('SELECT version')){const row=records.get(args[0]);return {rows:row?[structuredClone(row)]:[]};}
  if(sql.startsWith('UPDATE v3_campaign_state')){const row=records.get(args[0]);if(row?.version!==args[1])return {rowCount:0};records.set(args[0],{version:row.version+1,payload:JSON.parse(args[2])});return {rowCount:1};}
  throw Error('UNEXPECTED_SQL');
 }};
 let writes=0,notified=0;
 const service=await createPreparationReviewService({pool,reviewOrigin:'https://review.example.org',notify:async()=>{},reviewedLinks:[],researchEvidence:async()=>{throw Error('MUST_REUSE_RESEARCH');},renderVisual:async()=>{throw Error('MUST_REUSE_X');},fetcher:async()=>({ok:true,arrayBuffer:async()=>bytes}),write:async({campaignId,destination})=>{writes++;return {campaign_id:campaignId,destination_id:destination.id,kind:'EMAIL',subject:'Draft',body:'Evidence-backed draft',from:'sean@emradar.net',to:null,delivery_eligible:false,contact_status:'UNVERIFIED',evidence_ids:['e1']};}});
 service.workflow.issue=async campaignId=>{assert.equal((await service.reviewCompletion(campaignId)).complete,true);notified++;return {campaignId,status:'NOTIFIED'};};
 const result=await service.prepareAndNotify({snapshotDate:'2026-10-15',expectedSha256:hash,liveUrl:'https://emerging-markets-radar.onrender.com/data/discovery.json',archiveUrl:'https://emerging-markets-radar.onrender.com/data/checkpoints/discovery-2026-10-15.json'});
 assert.equal(result.status,'PUBLICATION_REVIEW');assert.equal(writes,1);assert.equal(notified,1);
 assert.equal(records.get(id).payload.assets.x.fingerprint,'saved-fingerprint');
 assert.equal(records.get(id).payload.assets.journal1,undefined);
});
