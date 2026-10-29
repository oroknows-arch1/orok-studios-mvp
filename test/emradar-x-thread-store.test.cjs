'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {ThreadStore}=require('../src/emradar-x-thread-store.cjs');
test('storage requires a query-capable pool',()=>assert.throws(()=>new ThreadStore({}),/POOL_REQUIRED/));
test('registration rolls back on duplicate or missing approval',async()=>{
 const calls=[],client={query:async(sql)=>{calls.push(sql);return {rowCount:1}},release:()=>{calls.push('RELEASE')}};
 const store=new ThreadStore({query:async()=>({}),connect:async()=>client});
 await assert.rejects(()=>store.register({campaign_id:'c',approved_segments:[{sequence:1,text:'a',approval_status:'APPROVED'},{sequence:2,text:'b',approval_status:'PENDING'}]}),/APPROVAL_REQUIRED/);
 assert.ok(calls.includes('ROLLBACK'));assert.ok(calls.includes('RELEASE'));
});
test('reservation requires accepted parent and returns receipt',async()=>{
 const calls=[],client={query:async(sql)=>{calls.push(sql);if(sql.includes('SELECT sequence'))return {rows:[{sequence:1,status:'ACCEPTED',receipt_id:'100'},{sequence:2,status:'PENDING',receipt_id:null}]};return {rowCount:1}},release:()=>{}};
 const store=new ThreadStore({query:async()=>({}),connect:async()=>client});
 const result=await store.reserve({campaign_id:'c',sequence:2});
 assert.equal(result.parent_receipt_id,'100');assert.ok(calls.includes('COMMIT'));
});
test('ambiguous preceding receipt blocks continuation',async()=>{
 const client={query:async(sql)=>sql.includes('SELECT sequence')?{rows:[{sequence:1,status:'AMBIGUOUS',receipt_id:null},{sequence:2,status:'PENDING',receipt_id:null}]}:{rowCount:1},release:()=>{}};
 const store=new ThreadStore({query:async()=>({}),connect:async()=>client});
 await assert.rejects(()=>store.reserve({campaign_id:'c',sequence:2}),/NOT_RESERVABLE/);
});
