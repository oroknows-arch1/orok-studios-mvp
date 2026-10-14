'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createV3IsolatedWiring}=require('../src/emradar-v3-wiring.cjs');

test('isolated V3 wiring constructs route without opening SMTP or querying database',async()=>{
 let smtpCalls=0,dbCalls=0;
 const pool={query:async()=>{dbCalls++;throw Error('UNEXPECTED_DATABASE_ACCESS');}};
 const integration=createV3IsolatedWiring({
  pool,token:'a'.repeat(40),reviewOrigin:'https://review.example.org',
  env:{EDITORIAL_SMTP_HOST:'smtp.example.org',EDITORIAL_SMTP_USER:'sean@emradar.net',EDITORIAL_SMTP_PASSWORD:'test-only'},
  createTransport:()=>{smtpCalls++;throw Error('UNEXPECTED_SMTP_ACCESS');}
 });
 assert.equal(typeof integration.route,'function');
 assert.equal(typeof integration.initialize,'function');
 assert.equal(smtpCalls,0);
 assert.equal(dbCalls,0);
 const response={statusCode:200,status(n){this.statusCode=n;return this;},json(v){this.body=v;return this;}};
 await integration.route({headers:{authorization:'Bearer invalid'},params:{operation:'approved-delivery'},body:{}},response);
 assert.equal(response.statusCode,403);
 assert.equal(smtpCalls,0);
 assert.equal(dbCalls,0);
});
