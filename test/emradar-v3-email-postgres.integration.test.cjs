'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {createV3PreparedIntegration}=require('../src/emradar-v3-integration.cjs');
const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(canonical(x))).digest('hex');
function response(){return {statusCode:200,status(n){this.statusCode=n;return this;},json(x){this.body=x;return this;}};}
test('V3 PostgreSQL prepared API: concurrent approved deliveries permit one simulated SMTP send',async t=>{
 if(!process.env.V3_TEST_DATABASE_URL){t.skip('Disposable V3_TEST_DATABASE_URL required');return;}
 const {Pool}=require('pg');
 const pool=new Pool({connectionString:process.env.V3_TEST_DATABASE_URL});
 t.after(async()=>pool.end());
 const id='v3-'+crypto.randomUUID(),destination='journal';
 const asset={campaign_id:id,destination_id:destination,kind:'EMAIL',subject:'Evidence update',body:'Evidence-based editorial correspondence'};
 const fingerprint=hash(asset);
 const approval={authority:'OWNER',decision:'APPROVE',asset_sha256:fingerprint,campaign_id:id,destination_id:destination};
 const key=hash([id,destination,fingerprint]);
 const state={phase:'PUBLICATION_REVIEW',assets:{[destination]:{asset,fingerprint}},decisions:{[destination]:approval},deliveries:{[destination]:{status:'ATTEMPTING',idempotency_key:key}}};
 await pool.query('INSERT INTO v3_campaign_state(campaign_id,version,payload) VALUES($1,1,$2::jsonb)',[id,JSON.stringify(state)]);
 let sends=0;
 const auth='test-only-token'.padEnd(48,'x');
 const integration=createV3PreparedIntegration({pool,token:auth,reviewOrigin:'https://review.example.org',sendOwnerReview:async()=>{throw Error('MUST_NOT_NOTIFY');},sendApprovedEmail:async()=>{sends++;return {accepted:true,receipt_id:'simulated-smtp-receipt'};}});
 const req={headers:{authorization:'Bearer '+auth},params:{operation:'approved-delivery'},body:{version:'EMRADAR_V3',kind:'APPROVED_DELIVERY',campaign_id:id,destination_id:destination,asset,approval,idempotency_key:key}};
 const run=async()=>{const res=response();await integration.route(req,res);return res;};
 const results=await Promise.all([run(),run()]);
 assert.deepEqual(results.map(r=>r.statusCode).sort(),[200,409]);
 assert.equal(sends,1);
 const receipt=await pool.query('SELECT status,provider_id FROM v3_send_reservations WHERE idempotency_key=$1',[key]);
 assert.equal(receipt.rows[0].status,'ACCEPTED');
 assert.equal(receipt.rows[0].provider_id,'simulated-smtp-receipt');
});
