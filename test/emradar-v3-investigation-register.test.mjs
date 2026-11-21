import test from 'node:test';
import assert from 'node:assert/strict';
import {ReviewWorkflow} from '../vendor/emradar-v3/src/review-workflow.js';

function fixture() {
 const original=Array.from({length:8},(_,index)=>({
  record_id:'discovery-'+(index+1),
  status:index===0?'ADMITTED':'NO_SUPPORTED_SIGNIFICANT_ANGLE',
  claims:[{id:'claim-'+index,status:index===0?'SUPPORTED':'UNRESOLVED'}]
 }));
 const campaign={
  id:'v3-test',phase:'PUBLICATION_REVIEW',scan:{snapshot_date:'2026-11-18'},
  assets:{},destinations:[],decisions:{},deliveries:{},events:[],
  preparation_input:{document:{records:[{id:'discovery-1'}],claim_audit:[original[0]]}},
  claim_gate_previous:{document:{claim_audit:original}},review_completion:{complete:true}
 };
 const adapter={read:async()=>({value:campaign}),compareAndSwap:async()=>true};
 const store={adapter,ensureEmailGroups:async()=>campaign,decide:async()=>{throw Error('NOT_ALLOWED')}};
 const workflow=new ReviewWorkflow({store,adapter,notify:async()=>{throw Error('NO_SEND')},baseUrl:'https://example.org'});
 workflow.authenticate=async()=>true;
 return {workflow,campaign};
}

test('single-record recovery preserves full eight-discovery owner triage',async()=>{
 const {workflow}=fixture();
 const view=await workflow.view('v3-test','session','secret');
 assert.equal(view.investigation.length,8);
 assert.equal(view.investigation.filter(item=>item.admitted).length,1);
 assert.equal(view.investigation.filter(item=>!item.admitted).length,7);
 assert.equal(view.entries.length,0);
 assert.equal(view.investigation.find(item=>item.id==='discovery-8').status,'NO_SUPPORTED_SIGNIFICANT_ANGLE');
});
test('newer claim audit status takes precedence and held candidates cannot be approved',async()=>{
 const {workflow,campaign}=fixture();
 campaign.preparation_input.document.claim_audit=[{record_id:'discovery-2',status:'SOURCE_INACCESSIBLE',claims:[]}];
 const view=await workflow.view('v3-test','session','secret');
 assert.equal(view.investigation.find(item=>item.id==='discovery-2').status,'SOURCE_INACCESSIBLE');
 await assert.rejects(workflow.decide('v3-test','session','secret','discovery-2','APPROVE','fake'),/V3_ACTIONABLE_REVIEW_REQUIRED/);
});

test('a signed evidence-held campaign can notify its owner without approving an asset',async()=>{
 const original=Array.from({length:8},(_,index)=>({
  record_id:'candidate-'+index,status:'NO_SUPPORTED_SIGNIFICANT_ANGLE',
  claims:[{id:'c-'+index,status:'UNRESOLVED'}]
 }));
 const state={
  id:'held-test',phase:'SCAN_VERIFIED',scan:{snapshot_date:'2026-11-21',artifact_sha256:'a'.repeat(64)},
  preparation_input:{document:{claim_audit:original,records:[],evidence:[]}},
  owner_investigation_records:original.map(item=>({id:item.record_id,theme:item.record_id})),
  assets:{},destinations:[],decisions:{},deliveries:{},events:[]
 };
 const table=new Map([['held-test',state]]);
 const adapter={
  read:async key=>table.has(key)?{value:table.get(key),version:1}:null,
  compareAndSwap:async(key,version,value)=>{table.set(key,value);return true;}
 };
 const store={adapter,ensureEmailGroups:async()=>{throw Error('MUST_NOT_PREPARE_HELD_ASSETS');},
  decide:async()=>{throw Error('MUST_NOT_APPROVE_HELD_CLAIM');}};
 let messages=0;
 const workflow=new ReviewWorkflow({store,adapter,baseUrl:'https://owner.example',
  notify:async input=>{messages++;assert.equal(input.recipient,'sean@emradar.net');return {
   accepted:true,provider_id:'test-mail-1',recipient:input.recipient,campaign_id:input.campaignId
  };}});
 const issued=await workflow.issue('held-test');
 assert.equal(issued.status,'NOTIFIED');
 assert.equal(messages,1);
 assert.equal(table.get('review:held-test').notification_receipt.accepted,true);
 workflow.authenticate=async()=>true;
 const view=await workflow.view('held-test','owner-session','secret');
 assert.equal(view.investigation_only,true);
 assert.equal(view.investigation.length,8);
 assert.deepEqual(view.entries,[]);
 await assert.rejects(workflow.decide('held-test','owner-session','secret','candidate-1','APPROVE','unused'),/V3_ACTIONABLE_REVIEW_REQUIRED/);
});
test('unsigned or unaudited scans cannot receive owner investigation invitations',async()=>{
 const state={phase:'SCAN_VERIFIED',scan:{artifact_sha256:'a'.repeat(64)},preparation_input:{document:{claim_audit:[]}}};
 const adapter={read:async()=>({value:state}),compareAndSwap:async()=>true};
 const workflow=new ReviewWorkflow({store:{adapter},adapter,baseUrl:'https://owner.example',notify:async()=>{throw Error('MUST_NOT_NOTIFY');}});
 await assert.rejects(workflow.issue('bad'),/CAMPAIGN_NOT_READY/);
});
