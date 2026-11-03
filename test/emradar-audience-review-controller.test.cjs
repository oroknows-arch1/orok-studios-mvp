'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{Readable}=require('node:stream'),{createHash}=require('node:crypto');
const {createAudienceReviewHandler}=require('../src/emradar-audience-review-controller.cjs');
const campaign='campaign-1',name='emradar_v3_session_'+createHash('sha256').update(campaign).digest('hex').slice(0,16);
function call(handler,action,input={},headers={}){const req=Readable.from([JSON.stringify({campaignId:campaign,...input})]);req.method='POST';req.url='/api/review/audience/'+action;req.headers={origin:'https://review.example',cookie:name+'=session.secret; emradar_v3_csrf=nonce','x-emradar-csrf':'nonce',...headers};return new Promise(resolve=>{const res={writeHead:(status)=>{res.status=status},end:body=>resolve({status:res.status,body:JSON.parse(body)})};handler(req,res);});}
test('review routes use existing owner session and exact asset/version identifiers',async()=>{
 const received=[],audience={view:async(...a)=>{received.push(a);return {xThread:{segments:[]}}},postDecision:async(...a)=>{received.push(a)},replyAction:async(...a)=>{received.push(a)},revise:async()=>{},present:async()=>{},decide:async()=>{}};
 const handler=createAudienceReviewHandler({audience,origin:'https://review.example'});
 assert.equal((await call(handler,'view')).status,200);assert.deepEqual(received[0],[campaign,'session','secret']);
 assert.equal((await call(handler,'post-decision',{record_id:'discovery',decision:'APPROVE',fingerprint:'manifest',asset_sha256:'asset'})).status,200);assert.deepEqual(received[1],[campaign,'session','secret','discovery','APPROVE','manifest','asset']);
 assert.equal((await call(handler,'reply-action',{discovery_id:'d',action_id:'a',action:'REJECT',asset_sha256:'version'})).status,200);assert.deepEqual(received[2],[campaign,'session','secret','d','a','REJECT','version',undefined]);
});
test('denies missing cookie, forged origin, csrf and release routes',async()=>{
 let count=0;const audience={view:async()=>{count++},postDecision:async()=>{count++},replyAction:async()=>{count++}};
 const handler=createAudienceReviewHandler({audience,origin:'https://review.example'});
 assert.equal((await call(handler,'view',{}, {cookie:''})).status,403);assert.equal((await call(handler,'view',{}, {origin:'https://evil.example'})).status,403);assert.equal((await call(handler,'view',{}, {'x-emradar-csrf':'wrong'})).status,403);assert.equal((await call(handler,'release')).status,404);assert.equal(count,0);
});
