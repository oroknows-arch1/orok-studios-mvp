'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {Pool}=require('pg');
const {ThreadStore}=require('../src/emradar-x-thread-store.cjs');
const url=process.env.V3_TEST_DATABASE_URL;
test('real PostgreSQL: unique registration, ordered receipts, ambiguous halting', {skip:!url},async()=>{
 const pool=new Pool({connectionString:url});
 const store=new ThreadStore(pool),campaign='thread-integration-'+process.pid+'-'+Date.now();
 const approved_segments=[{sequence:1,text:'Summary',approval_status:'APPROVED'},{sequence:2,text:'Discovery one',record_id:'one',approval_status:'APPROVED'},{sequence:3,text:'Discovery two',record_id:'two',approval_status:'APPROVED'}];
 try{
  await store.initialize();
  await store.register({campaign_id:campaign,approved_segments});
  await assert.rejects(()=>store.register({campaign_id:campaign,approved_segments}),/ALREADY_REGISTERED/);
  await assert.rejects(()=>store.reserve({campaign_id:campaign,sequence:2}),/PARENT_NOT_ACCEPTED/);
  const first=await store.reserve({campaign_id:campaign,sequence:1});assert.equal(first.parent_receipt_id,null);
  await assert.rejects(()=>store.reserve({campaign_id:campaign,sequence:1}),/NOT_RESERVABLE/);
  await store.record({campaign_id:campaign,sequence:1,receipt_id:'111'});
  const second=await store.reserve({campaign_id:campaign,sequence:2});assert.equal(second.parent_receipt_id,'111');
  await store.record({campaign_id:campaign,sequence:2,ambiguous:true});
  await assert.rejects(()=>store.reserve({campaign_id:campaign,sequence:3}),/NOT_RESERVABLE/);
  const rows=await pool.query('SELECT sequence,status,receipt_id,parent_receipt_id FROM emradar_x_thread_posts WHERE campaign_id=$1 ORDER BY sequence',[campaign]);
  assert.deepEqual(rows.rows.map(x=>x.status),['ACCEPTED','AMBIGUOUS','PENDING']);
 }finally{
  await pool.query('DELETE FROM emradar_x_thread_posts WHERE campaign_id=$1',[campaign]).catch(()=>{});
  await pool.end();
 }
});
