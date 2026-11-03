'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {planDailyThread,validateApproval}=require('../src/emradar-x-thread-plan.cjs');
const doc={publication_state:'PUBLISHED',snapshot_date:'2026-10-30',records:[{id:'a',state:'FORMING'},{id:'b',state:'INVESTIGATE'}]};
test('every discovery gets a segment in source order',()=>{
 const p=planDailyThread({document:doc,summary:'Daily scan',renderRecord:r=>r.id+' '+r.state});
 assert.equal(p.segments.length,3);assert.deepEqual(p.record_ids,['a','b']);assert.equal(p.publication_status,'DRAFT_ONLY');
});
test('all exact segments must be approved',()=>{
 const p=planDailyThread({document:doc,summary:'Daily scan',renderRecord:r=>r.id});
 assert.equal(validateApproval(p,p.segments.map(x=>({...x,approval_status:'APPROVED'}))),true);
 assert.throws(()=>validateApproval(p,p.segments.slice(0,2)),/INCOMPLETE/);
 assert.throws(()=>validateApproval(p,p.segments.map((x,i)=>({...x,text:i===1?'altered':x.text,approval_status:'APPROVED'}))),/MISMATCH/);
});
test('duplicate discovery identifiers are rejected',()=>assert.throws(()=>planDailyThread({document:{...doc,records:[doc.records[0],doc.records[0]]},summary:'Daily scan',renderRecord:r=>r.id}),/RECORD_ID/));
