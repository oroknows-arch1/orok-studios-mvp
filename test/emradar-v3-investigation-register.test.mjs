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
