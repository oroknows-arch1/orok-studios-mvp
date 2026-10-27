'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {pollOnce}=require('../src/audience-intelligence/independent-poller.cjs');
const snapshot={campaign_id:'v3-test',payload:{deliveries:{x:{status:'ACCEPTED',receipt:{accepted:true,post_url:'https://x.com/oroknows/status/123',provider_id:'123',receipt_id:'receipt-1'}}}}};
const proof={attested:true,campaignId:'v3-test',ownerApprovedX:true,formationId:'formation-1',digest:'sha256-fixture',scanUrl:'https://emradar.net/scan',sourceIds:['source-1']};
test('independent poller maps actual V3 shape and only writes audience jobs',async()=>{
 const jobs=[];const result=await pollOnce({readSnapshots:async()=>[snapshot],attestResearch:async()=>proof,saveAudienceJob:async job=>jobs.push(job)});
 assert.equal(result.saved,1);assert.equal(jobs[0].v3WriteAllowed,false);
});
test('unattested research does not activate',async()=>{
 let called=false;const result=await pollOnce({readSnapshots:async()=>[snapshot],attestResearch:async()=>({...proof,attested:false}),saveAudienceJob:async()=>{called=true}});
 assert.equal(result.saved,0);assert.equal(called,false);
});
test('V3 source failure is contained within audience polling',async()=>{
 const result=await pollOnce({readSnapshots:async()=>{throw Error('offline')},attestResearch:async()=>proof,saveAudienceJob:async()=>{}});
 assert.equal(result.status,'AUDIENCE_SOURCE_UNAVAILABLE');
});
test('duplicate observations do not create duplicate jobs in a cycle',async()=>{
 const jobs=[];const result=await pollOnce({readSnapshots:async()=>[snapshot,snapshot],attestResearch:async()=>proof,saveAudienceJob:async job=>jobs.push(job)});
 assert.equal(result.saved,1);assert.equal(jobs.length,1);
});
