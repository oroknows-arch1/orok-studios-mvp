'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createThreadExecutor}=require('../src/emradar-x-thread-executor.cjs');
const approved_thread={segments:[{sequence:1,text:'Lead',approval_status:'APPROVED'},{sequence:2,text:'Discovery',approval_status:'APPROVED'}]};
test('verification happens before reservation or X transport',async()=>{
 let calls=[];
 const fn=createThreadExecutor({store:{reserve:async()=>{calls.push('reserve')},record:async()=>{}},verifyApprovedThread:async()=>false,publishPost:async()=>{calls.push('post')}});
 await assert.rejects(()=>fn({campaign_id:'c',sequence:1,approved_thread}),/NOT_VERIFIED/);
 assert.deepEqual(calls,[]);
});
test('accepted X receipt is durably recorded',async()=>{
 let recorded;
 const fn=createThreadExecutor({store:{reserve:async()=>({parent_receipt_id:'100'}),record:async(x)=>{recorded=x;return x}},verifyApprovedThread:async()=>true,publishPost:async(x)=>{assert.equal(x.parent_receipt_id,'100');return {accepted:true,receipt_id:'101'}}});
 const r=await fn({campaign_id:'c',sequence:2,approved_thread});
 assert.equal(r.status,'ACCEPTED');assert.equal(recorded.receipt_id,'101');
});
test('transport failure halts and records ambiguous',async()=>{
 let recorded;
 const fn=createThreadExecutor({store:{reserve:async()=>({parent_receipt_id:null}),record:async(x)=>{recorded=x}},verifyApprovedThread:async()=>true,publishPost:async()=>{throw Error('timeout')}});
 const r=await fn({campaign_id:'c',sequence:1,approved_thread});
 assert.equal(r.status,'HALTED_AMBIGUOUS');assert.equal(recorded.ambiguous,true);
});
test('unconfirmed receipt cannot count as published',async()=>{
 let recorded;
 const fn=createThreadExecutor({store:{reserve:async()=>({parent_receipt_id:null}),record:async(x)=>{recorded=x}},verifyApprovedThread:async()=>true,publishPost:async()=>({accepted:true})});
 const r=await fn({campaign_id:'c',sequence:1,approved_thread});
 assert.equal(r.status,'HALTED_AMBIGUOUS');assert.equal(recorded.ambiguous,true);
});
