'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {pollOnce}=require('../src/audience-intelligence/independent-poller.cjs');
const snapshot={campaign_id:'fixture',payload:{deliveries:{x:{status:'ACCEPTED',receipt:{accepted:true,post_url:'https://x.com/a/status/123',provider_id:'123',receipt_id:'r'}}}}};
const proof={attested:true,campaignId:'fixture',ownerApprovedX:true,formationId:'f',digest:'sha',scanUrl:'https://emradar.net/x',sourceIds:['s']};
test('unavailable V3 read returns audience-only error and does not invoke sink',async()=>{
 let writes=0;
 const result=await pollOnce({readSnapshots:async()=>{throw Error('db unavailable')},attestResearch:async()=>proof,saveAudienceJob:async()=>{writes++}});
 assert.equal(result.status,'AUDIENCE_SOURCE_UNAVAILABLE');assert.equal(writes,0);
});
test('audience storage error is contained and does not mutate V3 snapshot',async()=>{
 const before=JSON.stringify(snapshot);
 const result=await pollOnce({readSnapshots:async()=>[snapshot],attestResearch:async()=>proof,saveAudienceJob:async()=>{throw Error('storage unavailable')}});
 assert.equal(result.errors,1);assert.equal(JSON.stringify(snapshot),before);
});
test('slow read remains an unresolved timeout risk until bounded by caller',async()=>{
 let release;const gate=new Promise(resolve=>release=resolve);
 const pending=pollOnce({readSnapshots:()=>gate,attestResearch:async()=>proof,saveAudienceJob:async()=>{}});
 release([]);
 const result=await pending;
 assert.equal(result.status,'AUDIENCE_POLL_COMPLETED');
});
