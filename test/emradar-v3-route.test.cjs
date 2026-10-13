'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createV3Route}=require('../src/emradar-v3-route.cjs');
const token='v3-integration-test-token'.padEnd(48,'x');
function response(){return {statusCode:200,status(n){this.statusCode=n;return this;},json(value){this.body=value;return this;}};}
test('V3 route is isolated, authenticated and cannot invoke transport without token',async()=>{
 let calls=0;
 const route=createV3Route({token,handle:async input=>{calls++;return {operation:input.operation};}});
 for(const authorization of [undefined,'Bearer wrong','Bearer '+token+'x']){
  const res=response();
  await route({headers:{authorization},params:{operation:'approved-delivery'},body:{}},res);
  assert.equal(res.statusCode,403);
 }
 assert.equal(calls,0);
 let res=response();
 await route({headers:{authorization:'Bearer '+token},params:{operation:'submit'},body:{}},res);
 assert.equal(res.statusCode,404);
 assert.equal(calls,0);
 res=response();
 await route({headers:{authorization:'Bearer '+token},params:{operation:'owner-notification'},body:{version:'EMRADAR_V3'}},res);
 assert.equal(res.statusCode,200);
 assert.equal(res.body.operation,'owner-notification');
 assert.equal(calls,1);
});
test('V3 route redacts internal transport errors and requires dedicated token',async()=>{
 assert.throws(()=>createV3Route({token:'short',handle:async()=>{}}),/V3_ROUTE_CONFIGURATION_REQUIRED/);
 const route=createV3Route({token,handle:async()=>{throw Error('SMTP credentials hidden');}});
 const res=response();
 await route({headers:{authorization:'Bearer '+token},params:{operation:'approved-delivery'},body:{}},res);
 assert.equal(res.statusCode,409);
 assert.deepEqual(res.body,{reason:'V3_OPERATION_UNCONFIRMED'});
});
