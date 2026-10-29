'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {assetHash}=require('../src/emradar-audience-asset-hash.cjs');
const {createApprovedThreadRegistration}=require('../src/emradar-audience-approved-registration.cjs');
const segments=[{sequence:1,kind:'SUMMARY',record_id:null,text:'Lead',media:null,approval_status:'APPROVED'},{sequence:2,kind:'DISCOVERY',record_id:'a',text:'Finding',media:null,approval_status:'APPROVED'}].map(x=>({...x,asset_sha256:assetHash(x)}));
test('verified exact segments are registered',async()=>{
 let saved;
 const register=createApprovedThreadRegistration({store:{register:async x=>{saved=x}},verifyApprovedThread:async()=>true});
 const result=await register({campaign_id:'c',approved_thread:{segments}});
 assert.equal(result.status,'REGISTERED');assert.equal(saved.approved_segments[1].asset_sha256,assetHash(segments[1]));
});
test('untrusted approval cannot create reservations',async()=>{
 let called=false;
 const register=createApprovedThreadRegistration({store:{register:async()=>{called=true}},verifyApprovedThread:async()=>false});
 await assert.rejects(()=>register({campaign_id:'c',approved_thread:{segments}}),/NOT_VERIFIED/);assert.equal(called,false);
});
test('tampered text or media cannot reach store',async()=>{
 let called=false;
 const register=createApprovedThreadRegistration({store:{register:async()=>{called=true}},verifyApprovedThread:async()=>true});
 const altered=segments.map(x=>({...x}));altered[1].text='Changed';
 await assert.rejects(()=>register({campaign_id:'c',approved_thread:{segments:altered}}),/HASH_MISMATCH/);assert.equal(called,false);
 const alteredMedia=segments.map(x=>({...x}));alteredMedia[0].media={media_ids:['42']};
 await assert.rejects(()=>register({campaign_id:'c',approved_thread:{segments:alteredMedia}}),/HASH_MISMATCH/);assert.equal(called,false);
});
test('missing approval and nonsequential segments are rejected',async()=>{
 const register=createApprovedThreadRegistration({store:{register:async()=>{}},verifyApprovedThread:async()=>true});
 await assert.rejects(()=>register({campaign_id:'c',approved_thread:{segments:[{...segments[0],approval_status:'PENDING'},segments[1]]}}),/SEGMENT_INVALID/);
 await assert.rejects(()=>register({campaign_id:'c',approved_thread:{segments:[segments[1],segments[0]]}}),/SEGMENT_INVALID/);
});
