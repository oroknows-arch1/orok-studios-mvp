'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {V3Reservations}=require('../src/emradar-v3-reservations.cjs');
test('V3 paid API reservation storage is inert until initialization',()=>{
 assert.throws(()=>new V3Reservations(null),/V3_POSTGRES_POOL_REQUIRED/);
 const queries=[];const store=new V3Reservations({query:async(sql)=>{queries.push(sql);return {rowCount:1};}});
 assert.equal(queries.length,0);
 assert.equal(typeof store.send.reserve,'function');
 assert.equal(typeof store.owner.reserve,'function');
 assert.equal(queries.length,0);
});
test('V3 reservations use atomic insert and block duplicates',async()=>{
 const seen=new Set(),records=[];
 const pool={query:async(sql,args)=>{
  records.push({sql,args});
  if(sql.includes('INSERT INTO')){const key=sql.includes('v3_send_')?'send:'+args[0]:'owner:'+args[0];if(seen.has(key))return {rowCount:0};seen.add(key);}
  return {rowCount:1};
 }};
 const store=new V3Reservations(pool);
 const send={idempotency_key:'a'.repeat(64),campaign_id:'v3',destination_id:'outlet',asset_sha256:'b'.repeat(64)};
 await store.send.reserve(send);
 await assert.rejects(store.send.reserve(send),/V3_SEND_ALREADY_RESERVED/);
 await store.owner.reserve({campaign_id:'v3',link_sha256:'c'.repeat(64)});
 await assert.rejects(store.owner.reserve({campaign_id:'v3',link_sha256:'c'.repeat(64)}),/V3_OWNER_NOTIFICATION_ALREADY_RESERVED/);
 assert.equal(records.filter(x=>x.sql.includes('ON CONFLICT DO NOTHING')).length,4);
});
