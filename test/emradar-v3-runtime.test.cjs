'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {mountV3PreparationReview}=require('../src/emradar-v3-runtime.cjs');
test('disabled runtime is inert and registers no sending routes',async()=>{
 const routes=[];
 assert.deepEqual(await mountV3PreparationReview({app:{post:(...args)=>routes.push(args)},env:{}}),{enabled:false});
 assert.deepEqual(routes,[]);
});
test('activation refuses missing configuration before connecting',async()=>{
 let connected=false;
 await assert.rejects(mountV3PreparationReview({
  app:{post:()=>{}},env:{EMRADAR_V3_PREPARATION_ENABLED:'true'},
  createPool:()=>{connected=true;return {};}
 }),/V3_ACTIVATION_CONFIG_REQUIRED/);
 assert.equal(connected,false);
});
test('activation initializes only V3 tables and exposes owner-notification only',async()=>{
 const routes=[],sql=[];
 const pool={query:async q=>{sql.push(q);return {rows:[],rowCount:0};},end:async()=>{}};
 const env={EMRADAR_V3_PREPARATION_ENABLED:'true',EMRADAR_V3_DATABASE_URL:'postgres://example.invalid/db',EMRADAR_V3_API_TOKEN:'t'.repeat(40),EMRADAR_V3_REVIEW_ORIGIN:'https://review.example.org'};
 const result=await mountV3PreparationReview({
  app:{post:(...args)=>routes.push(args)},env,createPool:()=>pool
 });
 assert.equal(result.enabled,true);
 assert.deepEqual(routes.map(r=>r[0]),['/emradar/v3/owner-notification']);
 assert.equal(sql.length,2);
 assert(sql.every(q=>q.includes('CREATE TABLE IF NOT EXISTS v3_')));
});
