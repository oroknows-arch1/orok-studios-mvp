'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {createV3NotificationVerifier}=require('../src/emradar-v3-notification-verifier.cjs');
test('V3 notification verifier validates durable review token and ready campaign',async()=>{
 const id='v3-test',token='secret-test-token',now=100000;
 const records=[
  {campaign_id:id,payload:{phase:'PUBLICATION_REVIEW'}},
  {campaign_id:'review:'+id,payload:{campaign_id:id,status:'ISSUED',token_hash:crypto.createHash('sha256').update(token).digest('hex'),consumed_at:null,expires_at:now+1000}}
 ];
 const verifier=createV3NotificationVerifier({pool:{query:async()=>({rows:records})},clock:()=>now});
 const payload={campaign_id:id,private_review_url:'https://example.org/review/access#token='+token+'&campaign='+id};
 assert.equal(await verifier(payload),true);
 await assert.rejects(verifier({...payload,private_review_url:'https://example.org/review/access#token=wrong&campaign='+id}),/V3_PRIVATE_LINK_MISMATCH/);
 records[1].payload.status='CONSUMED';
 await assert.rejects(verifier(payload),/V3_DURABLE_NOTIFICATION_REQUIRED/);
 records[1].payload.status='ISSUED';records[1].payload.expires_at=now-1;
 await assert.rejects(verifier(payload),/V3_DURABLE_NOTIFICATION_REQUIRED/);
});
test('V3 notification verifier rejects missing durable records',async()=>{
 const verifier=createV3NotificationVerifier({pool:{query:async()=>({rows:[]})}});
 await assert.rejects(verifier({campaign_id:'v3-missing',private_review_url:'https://example.org/review/access#token=abc&campaign=v3-missing'}),/V3_DURABLE_NOTIFICATION_REQUIRED/);
});
