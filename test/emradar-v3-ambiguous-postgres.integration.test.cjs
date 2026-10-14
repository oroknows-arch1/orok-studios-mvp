'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {createV3PreparedIntegration}=require('../src/emradar-v3-integration.cjs');
const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(canonical(x))).digest('hex');
const response=()=>({statusCode:200,status(n){this.statusCode=n;return this;},json(body){this.body=body;return this;}});
test('V3 PostgreSQL: uncertain SMTP outcome remains AMBIGUOUS and cannot be retried',async t=>{
 if(!process.env.V3_TEST_DATABASE_URL){t.skip('Disposable V3_TEST_DATABASE_URL required');return;}
 const {Pool}=require('pg');const pool=new Pool({connectionString:process.env.V3_TEST_DATABASE_URL});
 t.after(async()=>pool.end());
 const id='v3-'+crypto.randomUUID(),destination='outlet';
 const asset={campaign_id:id,destination_id:destination,kind:'EMAIL',body:'Evidence',subject:'Editorial'};
 const fingerprint=hash(asset),approval={authority:'OWNER',decision:'APPROVE',asset_sha256:fingerprint,campaign_id:id,destination_id:destination};
 const key=hash([id,destination,fingerprint]);
 const state={phase:'PUBLICATION_REVIEW',assets:{[destination]:{asset,fingerprint}},decisions:{[destination]:approval},deliveries:{[destination]:{status:'ATTEMPTING',idempotency_key:key}}};
 await pool.query('INSERT INTO v3_campaign_state(campaign_id,version,payload) VALUES($1,1,$2::jsonb)',[id,JSON.stringify(state)]);
 let sends=0;const token='test-token'.padEnd(48,'x');
 const integration=createV3PreparedIntegration({pool,token,reviewOrigin:'https://review.example.org',sendOwnerReview:async()=>{throw Error('NOT_USED');},sendApprovedEmail:async()=>{sends++;throw Error('SMTP_CONNECTION_LOST_AFTER_HANDOFF');}});
 const req={headers:{authorization:'Bearer '+token},params:{operation:'approved-delivery'},body:{version:'EMRADAR_V3',kind:'APPROVED_DELIVERY',campaign_id:id,destination_id:destination,asset,approval,idempotency_key:key}};
 const invoke=async()=>{const res=response();await integration.route(req,res);return res;};
 const first=await invoke(),second=await invoke();
 assert.equal(first.statusCode,409);assert.equal(second.statusCode,409);assert.equal(sends,1);
 const receipt=await pool.query('SELECT status,provider_id FROM v3_send_reservations WHERE idempotency_key=$1',[key]);
 assert.equal(receipt.rows[0].status,'AMBIGUOUS');assert.equal(receipt.rows[0].provider_id,null);
});
