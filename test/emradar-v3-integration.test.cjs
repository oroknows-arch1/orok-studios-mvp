'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {createV3PreparedIntegration}=require('../src/emradar-v3-integration.cjs');
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
function response(){return {statusCode:200,status(n){this.statusCode=n;return this;},json(x){this.body=x;return this;}};}
test('V3 paid API prepared integration wires authenticated route, trusted persisted approval, reservation and simulated receipt',async()=>{
 const asset={campaign_id:'v3-integration',destination_id:'journal',kind:'EMAIL',body:'Evidence'};
 const approval={campaign_id:asset.campaign_id,destination_id:asset.destination_id,authority:'OWNER',decision:'APPROVE',asset_sha256:hash(asset)};
 const key=hash([asset.campaign_id,asset.destination_id,approval.asset_sha256]),events=[];
 const state={phase:'PUBLICATION_REVIEW',assets:{journal:{asset,fingerprint:hash(asset)}},decisions:{journal:approval},deliveries:{journal:{status:'ATTEMPTING',idempotency_key:key}}};
 const reserved=new Set();
 const pool={query:async(sql,args)=>{
  if(sql.startsWith('SELECT payload'))return {rows:[{payload:state}]};
  if(sql.includes('INSERT INTO v3_send_reservations')){events.push('reserve');if(reserved.has(args[0]))return {rowCount:0};reserved.add(args[0]);return {rowCount:1};}
  if(sql.includes('UPDATE v3_send_reservations')){events.push('record');return {rowCount:1};}
  return {rowCount:1};
 }};
 const token='integration-test-only'.padEnd(40,'x');
 const integration=createV3PreparedIntegration({pool,token,reviewOrigin:'https://example.org',verifyNotification:async()=>true,sendOwnerReview:async()=>({accepted:true,provider_id:'review'}),sendApprovedEmail:async()=>{events.push('smtp');return {accepted:true,receipt_id:'smtp-receipt'};}});
 assert.deepEqual(events,[]);
 const request={headers:{authorization:'Bearer '+token},params:{operation:'approved-delivery'},body:{version:'EMRADAR_V3',kind:'APPROVED_DELIVERY',campaign_id:asset.campaign_id,destination_id:asset.destination_id,asset,approval,idempotency_key:key}};
 let res=response();
 await integration.route(request,res);
 assert.equal(res.statusCode,200);assert.equal(res.body.receipt_id,'smtp-receipt');
 assert.deepEqual(events,['reserve','smtp','record']);
 res=response();await integration.route(request,res);
 assert.equal(res.statusCode,409);assert.equal(res.body.reason,'V3_SEND_ALREADY_RESERVED');
 assert.deepEqual(events,['reserve','smtp','record','reserve']);
});
