'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createV3Boundary}=require('../src/emradar-v3-boundary.cjs');
const base=()=>({
 verifyNotification:async()=>true,verifyApprovedDelivery:async()=>true,
 sendOwnerReview:async()=>({accepted:true,provider_id:'smtp-review'}),
 sendApprovedEmail:async()=>({accepted:true,receipt_id:'smtp-approved'}),
 notificationReservation:{reserve:async()=>{},record:async()=>{}},
 sendReservation:{reserve:async()=>{},record:async()=>{}}
});
test('V3 boundary fails closed without trusted verification and persistent reservations',()=>{
 assert.throws(()=>createV3Boundary({}),/V3_TRUSTED_DEPENDENCIES_REQUIRED/);
 assert.throws(()=>createV3Boundary({...base(),notificationReservation:null}),/V3_DURABLE_RESERVATIONS_REQUIRED/);
});
test('V3 owner notification verifies and reserves before simulated SMTP',async()=>{
 const events=[];const d=base();
 d.verifyNotification=async()=>events.push('verify');
 d.notificationReservation={reserve:async()=>events.push('reserve'),record:async()=>events.push('record')};
 d.sendOwnerReview=async()=>{events.push('smtp');return {accepted:true,provider_id:'smtp-review'};};
 const handler=createV3Boundary(d);
 const result=await handler({operation:'owner-notification',payload:{version:'EMRADAR_V3',kind:'OWNER_REVIEW',to:'oroknows@gmail.com',campaign_id:'v3-test',private_review_url:'https://example.org/review/access#token=abc'}});
 assert.equal(result.provider_id,'smtp-review');
 assert.deepEqual(events,['verify','reserve','smtp','record']);
});
test('V3 delivery requires trusted verifier before reserving and sending',async()=>{
 let reserved=false,sent=false;const d=base();
 d.verifyApprovedDelivery=async()=>{throw Error('V3_DURABLE_APPROVAL_REQUIRED');};
 d.sendReservation.reserve=async()=>{reserved=true;};
 d.sendApprovedEmail=async()=>{sent=true;};
 await assert.rejects(createV3Boundary(d)({operation:'approved-delivery',payload:{version:'EMRADAR_V3',kind:'APPROVED_DELIVERY',asset:{kind:'EMAIL'},idempotency_key:'a'.repeat(64)}}),/V3_DURABLE_APPROVAL_REQUIRED/);
 assert.equal(reserved,false);assert.equal(sent,false);
});
