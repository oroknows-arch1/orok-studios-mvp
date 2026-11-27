'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const page=fs.readFileSync(require.resolve('../vendor/emradar-v3-authoritative/clean/review.html'),'utf8');
test('owner review separates provider acceptance from delivered and polls without release',()=>{
 assert.match(page,/Sent — provider accepted · Delivery not confirmed/);
 assert.match(page,/does not prove arrival in the recipient inbox/);
 assert.match(page,/Provider receipt:/);assert.match(page,/Purelymail Sent copy:/);
 assert.match(page,/deliveryPollCount<20/);assert.match(page,/document\.visibilityState==='visible'/);
 assert.equal((page.match(/api\('release'/g)||[]).length,2);
});
