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
test('individual approvals and reply edits invalidate old versions',async()=>{
 const {createIndependentAudience}=require('../src/emradar-audience-independent.cjs'),{createHash}=require('node:crypto');
 const opportunity={action_id:'a',type:'REPLY',url:'https://x.com/a/status/1',evidence_ids:['d:0'],draft_text:'What changes for suppliers?'};
 const entries=new Map([[campaign,{version:1,payload:{id:campaign,events:[],audience_x_review:{mode:'STANDALONE',manifest_sha256:'m',segments:[{record_id:'d',asset_sha256:'h'}]},audience_x_research:{results:{d:{report:{opportunities:[opportunity]}}}}}}]]);
 const pool={query:async(sql,args)=>{if(sql.startsWith('SELECT version,payload')){const value=entries.get(args[0]);return {rows:value?[{version:value.version,value:structuredClone(value.payload)}]:[]};}if(sql.startsWith('UPDATE emradar_audience_state')){const value=entries.get(args[0]);if(!value||value.version!==args[1])return {rowCount:0};entries.set(args[0],{version:value.version+1,payload:structuredClone(args[2])});return {rowCount:1};}return {rows:[],rowCount:0};}};
 const engine=await createIndependentAudience({audiencePool:pool,readSource:async()=>null,readOwnerAccess:async()=>null,authenticateOwner:async(id,session,secret)=>{if(secret!=='secret')throw Error('ACCESS_DENIED')},loadPublishedBytes:async()=>Buffer.alloc(0),x:{prepareThreadPost:async()=>{}}});
 await assert.rejects(()=>engine.decide(campaign,'session','secret','APPROVE','m'),/INDIVIDUAL_APPROVALS_REQUIRED/);
 await assert.rejects(()=>engine.postDecision(campaign,'session','wrong','d','APPROVE','m','h'),/ACCESS_DENIED/);
 await engine.postDecision(campaign,'session','secret','d','APPROVE','m','h');
 assert.equal(entries.get(campaign).payload.audience_post_decisions.d.asset_sha256,'h');
 await assert.rejects(()=>engine.postDecision(campaign,'session','secret','d','APPROVE','m','old'),/DECISION_INVALID/);
 const sha=o=>createHash('sha256').update(JSON.stringify({action_id:o.action_id,type:o.type,url:o.url,evidence_ids:o.evidence_ids,text:o.draft_text})).digest('hex');
 const old=sha(opportunity);await engine.replyAction(campaign,'session','secret','d','a','APPROVE',old);
 await engine.replyAction(campaign,'session','secret','d','a','EDIT',old,'How might higher costs affect suppliers?');
 const revised=entries.get(campaign).payload.audience_x_research.results.d.report.opportunities[0];assert.equal(revised.owner_decision,undefined);assert.notEqual(revised.review_sha256,old);
 await assert.rejects(()=>engine.replyAction(campaign,'session','secret','d','a','APPROVE',old),/REPLY_STALE/);
});
