'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createXThreadTransport}=require('../src/emradar-x-thread-transport.cjs');
test('linked post uses reply parent and exact approved text',async()=>{
 let sent;
 const publish=createXThreadTransport({accessToken:'test-token',fetchImpl:async(url,opts)=>{sent={url,opts};return {ok:true,json:async()=>({data:{id:'789'}})}}});
 const r=await publish({text:'Finding',parent_receipt_id:'123',media:{media_ids:['456']}});
 assert.equal(r.receipt_id,'789');assert.equal(sent.url,'https://api.x.com/2/tweets');
 assert.deepEqual(JSON.parse(sent.opts.body),{text:'Finding',reply:{in_reply_to_tweet_id:'123'},media:{media_ids:['456']}});
});
test('lead post does not include reply parent',async()=>{
 let body;
 const publish=createXThreadTransport({accessToken:'test-token',fetchImpl:async(_,opts)=>{body=JSON.parse(opts.body);return {ok:true,json:async()=>({data:{id:'1'}})}}});
 await publish({text:'Lead'});assert.equal(body.reply,undefined);
});
test('unconfirmed response fails closed',async()=>{
 const publish=createXThreadTransport({accessToken:'test-token',fetchImpl:async()=>({ok:true,json:async()=>({data:{}})})});
 await assert.rejects(()=>publish({text:'Lead'}),/RECEIPT_MISSING/);
});
test('invalid parent and media are rejected before network',async()=>{
 const publish=createXThreadTransport({accessToken:'test-token',fetchImpl:async()=>{throw Error('network must not run')}});
 await assert.rejects(()=>publish({text:'Lead',parent_receipt_id:'bad'}),/PARENT_INVALID/);
 await assert.rejects(()=>publish({text:'Lead',media:{media_ids:['bad']}}),/MEDIA_INVALID/);
});
