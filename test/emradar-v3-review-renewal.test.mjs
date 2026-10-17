import test from 'node:test';
import assert from 'node:assert/strict';
import {ReviewWorkflow} from '../vendor/emradar-v3/src/review-workflow.js';
import {reviewPage} from '../vendor/emradar-v3/src/review-page.js';
test('consumed review can be renewed once while preserving old receipt and campaign decisions',async()=>{
 const campaign={phase:'PUBLICATION_REVIEW',decisions:{x:{decision:'REJECT'}}};
 const old={campaign_id:'v3-test',status:'CONSUMED',expires_at:2000,consumed_at:10,notification_receipt:{provider_id:'old'}};
 let review=old,version=1,sends=0;
 const adapter={read:async key=>({value:key==='v3-test'?campaign:review,version}),compareAndSwap:async(_key,v,next)=>{assert.equal(v,version);review=next;version++;return true;}};
 const flow=new ReviewWorkflow({store:{adapter},adapter,baseUrl:'https://review.example',clock:()=>1000,notify:async({campaignId,recipient})=>{sends++;return {accepted:true,provider_id:'new',campaign_id:campaignId,recipient};}});
 await flow.issue('v3-test');
 assert.equal(review.status,'NOTIFIED');assert.equal(review.previous_reviews[0].notification_receipt.provider_id,'old');assert.equal(campaign.decisions.x.decision,'REJECT');
 await assert.rejects(flow.issue('v3-test'),/ALREADY_ISSUED/);assert.equal(sends,1);
});
test('review renders saved HTML inside a sandbox without script permissions',()=>{
 assert.match(reviewPage,/preview\.setAttribute\('sandbox',''\)/);
 assert.match(reviewPage,/preview\.srcdoc=asset\.html/);
});

test('reopening the emailed link tries the saved session before attempting single-use token exchange',()=>{
 const start=reviewPage.slice(reviewPage.indexOf('(async()=>{'));
 assert(start.indexOf('try{await refresh();}')<start.indexOf("api('exchange'"));
 assert.match(reviewPage,/Send this exact approved email/);
 assert.match(reviewPage,/Publish approved X post/);
 assert.match(reviewPage,/Publish this exact approved text and graphic/);
});
function fixture(){
 const records=new Map(),notifications=[];let now=1000000;
 const campaign={phase:'PUBLICATION_REVIEW',scan:{},destinations:[{id:'x'}],assets:{x:{asset:{kind:'X',destination_id:'x',body:'Approved text'},fingerprint:'keep'}},decisions:{x:{decision:'APPROVE',asset_sha256:'keep'}},deliveries:{}};
 for(const id of ['campaign','second'])records.set(id,{version:1,value:structuredClone(campaign)});
 const adapter={read:async key=>structuredClone(records.get(key)??null),compareAndSwap:async(key,v,value)=>{const prior=records.get(key);if((prior?.version??null)!==v)return false;records.set(key,{version:(v??0)+1,value:structuredClone(value)});return true;}};
 const workflow=new ReviewWorkflow({store:{adapter},adapter,baseUrl:'https://review.example',clock:()=>now,notify:async input=>{notifications.push(input);return {accepted:true,provider_id:'mail-'+notifications.length,recipient:input.recipient,campaign_id:input.campaignId};}});
 return {records,workflow,notifications,adapter,campaign,advance:ms=>now+=ms};
}
test('persistent session renews only while valid; consumed tokens, expiry and revocation remain enforced',async()=>{
 const f=fixture();await f.workflow.issue('campaign');
 const token=new URLSearchParams(new URL(f.notifications[0].link).hash.slice(1)).get('token');
 const session=await f.workflow.exchange('campaign',token);
 assert.equal(session.expiresAt,1000000+30*86400000);
 f.advance(86400000);const renewed=await f.workflow.renewSession('campaign',session.sessionId,session.secret);
 assert.equal(renewed,1000000+31*86400000);
 assert.equal((await f.workflow.view('campaign',session.sessionId,session.secret)).entries[0].decision.decision,'APPROVE');
 await assert.rejects(f.workflow.exchange('campaign',token),/REVIEW_ACCESS_DENIED/);
 await assert.rejects(f.workflow.view('second',session.sessionId,session.secret),/OWNER_SESSION_REQUIRED/);
 f.advance(31*86400000);await assert.rejects(f.workflow.renewSession('campaign',session.sessionId,session.secret),/OWNER_SESSION_REQUIRED/);
 assert.deepEqual(f.records.get('campaign').value,f.campaign);
});
test('owner-requested recovery sends only to fixed owner, preserves decisions and blocks duplicate requests',async()=>{
 const f=fixture();await f.workflow.issue('campaign');
 const token=new URLSearchParams(new URL(f.notifications[0].link).hash.slice(1)).get('token');await f.workflow.exchange('campaign',token);
 assert.equal((await f.workflow.requestAccess('campaign',{token})).status,'SMTP_ACCEPTED');assert.equal(f.notifications.length,2);
 assert.equal(f.notifications[1].recipient,'sean@emradar.net');assert.deepEqual(f.records.get('campaign').value,f.campaign);
 const latestToken=new URLSearchParams(new URL(f.notifications[1].link).hash.slice(1)).get('token');assert.equal((await f.workflow.requestAccess('campaign',{token:latestToken})).status,'EXISTING_INVITATION');assert.equal(f.notifications.length,2);
 const freshToken=new URLSearchParams(new URL(f.notifications[1].link).hash.slice(1)).get('token');await f.workflow.exchange('campaign',freshToken);
 await assert.rejects(f.workflow.requestAccess('campaign',{token:freshToken}),/ALREADY_RECORDED/);assert.equal(f.notifications.length,2);
});
test('HTTP reopening uses per-campaign secure persistent cookies and never sends or releases',async t=>{
 const {createReviewServer}=await import('../vendor/emradar-v3/src/http.js');const f=fixture();
 await f.workflow.issue('campaign');const token=new URLSearchParams(new URL(f.notifications[0].link).hash.slice(1)).get('token');
 let releases=0;const server=createReviewServer({workflow:f.workflow,releaseEmail:async()=>{releases++;}});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const url='http://127.0.0.1:'+server.address().port+'/api/review/';const request=(path,payload,cookie)=>fetch(url+path,{method:'POST',headers:{'content-type':'application/json',origin:'https://review.example',...(cookie?{cookie}:{})},body:JSON.stringify(payload)});
 const exchange=await request('exchange',{campaignId:'campaign',token});assert.equal(exchange.status,200);
 const cookies=exchange.headers.getSetCookie();assert(cookies[0].includes('HttpOnly; Secure; SameSite=Strict'));assert(cookies[0].includes('Max-Age=2592000'));assert.match(cookies[0],/^emradar_v3_session_[a-f0-9]{16}=/);
 const cookie=cookies.map(c=>c.split(';')[0]).join('; ');
 const view=await request('view',{campaignId:'campaign'},cookie);assert.equal(view.status,200);assert.equal((await view.json()).entries[0].decision.decision,'APPROVE');
 assert.equal((await request('exchange',{campaignId:'campaign',token},cookie)).status,403);
 assert.equal((await request('view',{campaignId:'second'},cookie)).status,403);
 assert.equal((await request('release',{campaignId:'campaign',destinationId:'x'},cookie)).status,403);assert.equal(releases,0);assert.equal(f.notifications.length,1);
});
test('anonymous recovery cannot send mail or revoke an existing session',async()=>{
 const f=fixture();await f.workflow.issue('campaign');
 await assert.rejects(f.workflow.requestAccess('campaign'),/ACCESS_DENIED/);
 await assert.rejects(f.workflow.requestAccess('campaign',{token:'forged'}),/ACCESS_DENIED/);
 assert.equal(f.notifications.length,1);
});
