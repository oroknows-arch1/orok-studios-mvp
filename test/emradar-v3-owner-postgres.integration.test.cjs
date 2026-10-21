'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {createV3PreparedIntegration}=require('../src/emradar-v3-integration.cjs');
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
function response(){return {statusCode:200,status(n){this.statusCode=n;return this;},json(x){this.body=x;return this;}};}
test('V3 PostgreSQL prepared API: durable owner notification reserves once and rejects replay',async t=>{
 if(!process.env.V3_TEST_DATABASE_URL){t.skip('Disposable V3_TEST_DATABASE_URL required');return;}
 const {Pool}=require('pg');
 const pool=new Pool({connectionString:process.env.V3_TEST_DATABASE_URL});
 t.after(async()=>pool.end());
 const id='v3-'+crypto.randomUUID(),token='private-'+crypto.randomUUID(),origin='https://review.example.org';
 const review={campaign_id:id,status:'ISSUED',token_hash:crypto.createHash('sha256').update(token).digest('hex'),consumed_at:null,expires_at:Date.now()+600000};
 const state={phase:'PUBLICATION_REVIEW',assets:{},decisions:{},deliveries:{}};
 await pool.query('INSERT INTO v3_campaign_state(campaign_id,version,payload) VALUES($1,1,$2::jsonb),($3,1,$4::jsonb)',[id,JSON.stringify(state),'review:'+id,JSON.stringify(review)]);
 const events=[],auth='test-token'.padEnd(48,'x');
 const integration=createV3PreparedIntegration({pool,token:auth,reviewOrigin:origin,sendOwnerReview:async()=>{events.push('smtp');return {accepted:true,provider_id:'simulated-review-receipt'};},sendApprovedEmail:async()=>{throw Error('MUST_NOT_SEND');}});
 const payload={version:'EMRADAR_V3',kind:'OWNER_REVIEW',campaign_id:id,to:'sean@emradar.net',private_review_url:origin+'/review/access#token='+encodeURIComponent(token)+'&campaign='+encodeURIComponent(id)};
 const req={headers:{authorization:'Bearer '+auth},params:{operation:'owner-notification'},body:payload};
 const run=async()=>{const res=response();await integration.route(req,res);return res;};
 const results=await Promise.all([run(),run()]);
 assert.deepEqual(results.map(r=>r.statusCode).sort(),[200,409]);
 assert.deepEqual(events,['smtp']);
 const record=await pool.query('SELECT status,provider_id FROM v3_owner_notification_reservations WHERE campaign_id=$1',[id+':review:'+crypto.createHash('sha256').update(payload.private_review_url).digest('hex')]);
 assert.equal(record.rows[0].status,'ACCEPTED');assert.equal(record.rows[0].provider_id,'simulated-review-receipt');
});
