import test from 'node:test';
import assert from 'node:assert/strict';
import {ReviewWorkflow} from '../vendor/emradar-v3/src/review-workflow.js';

const scanId='v3-held';
const source=Array.from({length:7},(_,i)=>({
 id:'record-'+i,theme:'Scanner candidate '+i,why_surfaced:'Unverified scan hypothesis',status:'INVESTIGATE'
}));
function fixture(){
 const state={phase:'SCAN_VERIFIED',scan:{artifact_sha256:'a'.repeat(64)},owner_investigation_records:structuredClone(source),
  preparation_input:{document:{records:[],evidence:[],claim_audit:source.map(item=>({
   record_id:item.id,status:'NO_SUPPORTED_SIGNIFICANT_ANGLE',claims:[]
  }))}},assets:{},destinations:[],events:[],decisions:{},deliveries:{}};
 const data=new Map([[scanId,state]]);
 const adapter={read:async id=>data.has(id)?{value:data.get(id),version:1}:null,compareAndSwap:async()=>true};
 const store={adapter,mutate:async(id,fn)=>{const next=fn(structuredClone(data.get(id)));data.set(id,next);return next;},
  decide:async()=>{throw Error('DISTRIBUTION_NOT_ALLOWED')},
  ensureEmailGroups:async()=>{throw Error('NO_PREPARATION_FOR_HELD_SCAN')}};
 const workflow=new ReviewWorkflow({store,adapter,baseUrl:'https://owner.example',notify:async()=>{throw Error('NO_EMAIL')}});
 workflow.authenticate=async()=>true;
 return {workflow,data,state};
}
test('manual research triage persists with no publication assets or approvals',async()=>{
 const {workflow,data}=fixture();
 const result=await workflow.triageInvestigation(scanId,'session','secret','record-2','PRIORITIZE','Check primary permits and connected firms');
 assert.deepEqual(result,{saved:true,record_id:'record-2',decision:'PRIORITIZE'});
 const view=await workflow.view(scanId,'session','secret');
 assert.equal(view.investigation.length,7);
 assert.equal(view.investigation[2].owner_triage.decision,'PRIORITIZE');
 assert.equal(view.investigation[2].owner_triage.note,'Check primary permits and connected firms');
 assert.equal(view.entries.length,0);
 assert.equal(data.get(scanId).phase,'SCAN_VERIFIED');
 assert.deepEqual(data.get(scanId).assets,{});
 assert.deepEqual(data.get(scanId).decisions,{});
 assert.deepEqual(data.get(scanId).deliveries,{});
 await assert.rejects(workflow.decide(scanId,'session','secret','record-2','APPROVE','fake'),/V3_ACTIONABLE_REVIEW_REQUIRED/);
});
test('all seven candidates can be triaged independently without changing checked evidence',async()=>{
 const {workflow,data}=fixture();
 const before=JSON.stringify(data.get(scanId).preparation_input);
 for(let i=0;i<7;i++)await workflow.triageInvestigation(scanId,'session','secret','record-'+i,i===0?'PRIORITIZE':'DEFER');
 assert.equal(Object.keys(data.get(scanId).owner_investigation_triage).length,7);
 assert.equal(JSON.stringify(data.get(scanId).preparation_input),before);
});
test('triage rejects fabricated candidates and malformed decisions',async()=>{
 const {workflow}=fixture();
 await assert.rejects(workflow.triageInvestigation(scanId,'session','secret','record-99','PRIORITIZE'),/UNKNOWN_INVESTIGATION_RECORD/);
 await assert.rejects(workflow.triageInvestigation(scanId,'session','secret','record-1','APPROVE'),/INVALID_INVESTIGATION_TRIAGE/);
 await assert.rejects(workflow.triageInvestigation(scanId,'session','secret','record-1','PRIORITIZE','a'.repeat(1501)),/INVALID_INVESTIGATION_TRIAGE/);
});
test('triage refuses retired campaigns',async()=>{
 const {workflow,data}=fixture();
 data.get(scanId).phase='CLOSED';
 await assert.rejects(workflow.triageInvestigation(scanId,'session','secret','record-1','PRIORITIZE'),/REVIEW_NOT_OPEN/);
});

test('older review with preserved claim audit supports manual triage without new scanner summary',async()=>{
 const {workflow,data}=fixture();
 data.get(scanId).phase='PUBLICATION_REVIEW';
 delete data.get(scanId).owner_investigation_records;
 await workflow.triageInvestigation(scanId,'session','secret','record-3','PRIORITIZE','Recheck source');
 const view=await workflow.view(scanId,'session','secret');
 assert.equal(view.investigation.find(item=>item.id==='record-3').owner_triage.decision,'PRIORITIZE');
});
