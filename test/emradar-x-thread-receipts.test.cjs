'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {initializeThread,reserveNext,recordResult}=require('../src/emradar-x-thread-receipts.cjs');
const approved=[{sequence:1,text:'Summary',approval_status:'APPROVED'},{sequence:2,text:'Finding',record_id:'record-a',approval_status:'APPROVED'}];
test('sequential receipt chain',()=>{
 let s=initializeThread({campaign_id:'c',approved_segments:approved});
 s=reserveNext(s);assert.equal(s.segments[0].in_reply_to,null);
 s=recordResult(s,{sequence:1,receipt_id:'123'});assert.equal(s.status,'PARTIAL');
 s=reserveNext(s);assert.equal(s.segments[1].in_reply_to,'123');
 s=recordResult(s,{sequence:2,receipt_id:'456'});assert.equal(s.status,'COMPLETE');
});
test('ambiguous outcome halts without retry',()=>{
 let s=reserveNext(initializeThread({campaign_id:'c',approved_segments:approved}));
 s=recordResult(s,{sequence:1,ambiguous:true});
 assert.equal(s.status,'HALTED_AMBIGUOUS');assert.throws(()=>reserveNext(s),/NOT_READY/);
});
test('approval and receipt are mandatory',()=>{
 assert.throws(()=>initializeThread({campaign_id:'c',approved_segments:[approved[0],{...approved[1],approval_status:'PENDING'}]}),/APPROVAL/);
 let s=reserveNext(initializeThread({campaign_id:'c',approved_segments:approved}));
 assert.throws(()=>recordResult(s,{sequence:1}),/RECEIPT/);
});
