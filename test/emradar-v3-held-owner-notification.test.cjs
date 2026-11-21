'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {createV3NotificationVerifier}=require('../src/emradar-v3-notification-verifier.cjs');
const token='unique-private-token';
const id='v3-held-test';
const origin='https://owner.example';
const link=origin+'/review/access#token='+encodeURIComponent(token)+'&campaign='+encodeURIComponent(id);
const hash=crypto.createHash('sha256').update(token).digest('hex');
const review={campaign_id:id,status:'ISSUED',consumed_at:null,expires_at:Date.now()+600000,token_hash:hash};
function verify(campaign){
 const pool={query:async()=>({rows:[{campaign_id:id,payload:campaign},{campaign_id:'review:'+id,payload:review}]})};
 return createV3NotificationVerifier({pool,reviewOrigin:origin});
}
const request={to:'sean@emradar.net',campaign_id:id,private_review_url:link};
const audit=[{record_id:'source-1',status:'SOURCE_INACCESSIBLE',claims:[]}];
test('held signed scan with claim audit can receive owner-only invitation',async()=>{
 assert.equal(await verify({phase:'SCAN_VERIFIED',scan:{artifact_sha256:'a'.repeat(64)},preparation_input:{document:{claim_audit:audit}}})(request),true);
});
test('standard publication review remains eligible',async()=>{
 assert.equal(await verify({phase:'PUBLICATION_REVIEW'})(request),true);
});
test('held scans without signed identity or audit remain blocked',async()=>{
 await assert.rejects(verify({phase:'SCAN_VERIFIED',scan:{artifact_sha256:'a'.repeat(64)},preparation_input:{document:{claim_audit:[]}}})(request),/V3_DURABLE_NOTIFICATION_REQUIRED/);
 await assert.rejects(verify({phase:'SCAN_VERIFIED',scan:{artifact_sha256:'bad'},preparation_input:{document:{claim_audit:audit}}})(request),/V3_DURABLE_NOTIFICATION_REQUIRED/);
});
test('other campaign phases cannot use investigation-only notification',async()=>{
 await assert.rejects(verify({phase:'CLOSED',scan:{artifact_sha256:'a'.repeat(64)},preparation_input:{document:{claim_audit:audit}}})(request),/V3_DURABLE_NOTIFICATION_REQUIRED/);
});
