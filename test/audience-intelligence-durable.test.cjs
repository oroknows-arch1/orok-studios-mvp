'use strict';
const { test }=require('node:test');
const assert=require('node:assert/strict');
const {Pool}=require('pg');
const {createAudienceJobSink}=require('../src/audience-intelligence/durable-job-sink.cjs');
const {pollOnce}=require('../src/audience-intelligence/independent-poller.cjs');
const url=process.env.AUDIENCE_TEST_DATABASE_URL;
test('durable deduplication across independent pools and repeated polls', {skip:!url},async()=>{
 const admin=new Pool({connectionString:url});
 const a=new Pool({connectionString:url});
 const b=new Pool({connectionString:url});
 const postId='12345678901234567890';
 const job={xPostId:postId,receiptId:'r1',formationId:'f1',digest:'a'.repeat(64),scanUrl:'https://emradar.net/test'};
 try{
  await admin.query('CREATE TABLE IF NOT EXISTS audience_jobs (x_post_id text PRIMARY KEY,receipt_id text NOT NULL,formation_id text NOT NULL,scan_sha256 char(64) NOT NULL,scan_url text NOT NULL,created_at timestamptz NOT NULL DEFAULT now())');
  await admin.query('DELETE FROM audience_jobs WHERE x_post_id=$1',[postId]);
  const results=await Promise.all([createAudienceJobSink(a)(job),createAudienceJobSink(b)(job)]);
  assert.equal(results.filter(x=>x.inserted).length,1);
  await a.end();
  const again=await createAudienceJobSink(b)(job);
  assert.equal(again.inserted,false);
  const count=await admin.query('SELECT count(*)::int AS n FROM audience_jobs WHERE x_post_id=$1',[postId]);
  assert.equal(count.rows[0].n,1);
 }finally{
  await admin.query('DELETE FROM audience_jobs WHERE x_post_id=$1',[postId]);
  await admin.end();await b.end();
 }
});
test('polling storage failure cannot mutate V3 snapshot',async()=>{
 const snapshot=Object.freeze({campaign_id:'x',payload:Object.freeze({deliveries:Object.freeze({x:Object.freeze({status:'ACCEPTED',receipt:Object.freeze({accepted:true,post_url:'https://x.com/a/status/123',provider_id:'123',receipt_id:'r'})})})})});
 const proof={attested:true,campaignId:'x',ownerApprovedX:true,formationId:'f',digest:'a'.repeat(64),scanUrl:'https://emradar.net/a',sourceIds:['s']};
 const r=await pollOnce({readSnapshots:async()=>[snapshot],attestResearch:async()=>proof,saveAudienceJob:async()=>{throw Error('audience database down')}});
 assert.equal(r.errors,1);assert.equal(r.saved,0);
});
