'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {createV3ApprovalVerifier}=require('../src/emradar-v3-approval-verifier.cjs');
const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(canonical(x))).digest('hex');
test('paid API V3 verifier reads persisted approval and claimed delivery, never trusts request alone',async()=>{
 const asset={campaign_id:'v3-campaign',destination_id:'journal',kind:'EMAIL',to:'editor@example.org',contact_status:'UNVERIFIED',delivery_eligible:false,body:'evidence'};
 const approval={campaign_id:asset.campaign_id,destination_id:asset.destination_id,authority:'OWNER',decision:'APPROVE',asset_sha256:hash(asset)};
 const key=hash([asset.campaign_id,asset.destination_id,approval.asset_sha256]);
 const state={phase:'PUBLICATION_REVIEW',assets:{journal:{asset,fingerprint:hash(asset)}},decisions:{journal:approval},deliveries:{journal:{status:'ATTEMPTING',idempotency_key:key}}};
 const reads=[];
 const verify=createV3ApprovalVerifier({pool:{query:async(sql,args)=>{if(sql.startsWith('SELECT record'))return {rows:[]};reads.push(args);return {rows:[{payload:state}]};}}});
 const request={asset,approval,idempotency_key:key,campaign_id:asset.campaign_id,destination_id:asset.destination_id};
 assert.equal(await verify(request),true);
 assert.deepEqual(reads,[['v3-campaign']]);
 await assert.rejects(verify({...request,approval:{...approval,asset_sha256:'b'.repeat(64)}}),/V3_DURABLE_APPROVAL_MISMATCH/);
 state.deliveries.journal.status='ACCEPTED';
 await assert.rejects(verify(request),/V3_DURABLE_CLAIM_REQUIRED/);
});
test('paid API verifier fails closed without saved campaign or database',async()=>{
 assert.throws(()=>createV3ApprovalVerifier({}),/V3_POSTGRES_POOL_REQUIRED/);
 const verify=createV3ApprovalVerifier({pool:{query:async()=>({rows:[]})}});
 const asset={campaign_id:'v3',destination_id:'outlet',kind:'EMAIL',body:'test'};
 await assert.rejects(verify({asset,approval:{campaign_id:'v3',destination_id:'outlet',authority:'OWNER',decision:'APPROVE',asset_sha256:hash(asset)},idempotency_key:'a'.repeat(64),campaign_id:'v3',destination_id:'outlet'}),/V3_DURABLE_APPROVAL_REQUIRED/);
});
