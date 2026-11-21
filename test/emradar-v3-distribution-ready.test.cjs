'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createV3PreparedIntegration}=require('../src/emradar-v3-integration.cjs');
const {createV3Smtp}=require('../src/emradar-v3-smtp.cjs');
const verified=require('./fixtures/v3-verified-recipient.cjs');
const {validRecipient}=require('../src/emradar-v3-recipient.cjs');

async function fixture(){
 const {sha256}=await import('../vendor/emradar-v3/src/contracts.js');
 const states=new Map(),receipts=new Map(),suppressed=[];
 const add=(id,decision='APPROVE')=>{
  const asset={campaign_id:'campaign',destination_id:id,kind:'EMAIL',to:id+'@journal.example',subject:'Article idea',body:'Evidence and possibility',evidence_ids:['e1'],from:'sean@emradar.net',contact_status:'VERIFIED',delivery_eligible:true};
  const fingerprint=sha256(asset),approval={authority:'OWNER',decision,asset_sha256:fingerprint,campaign_id:'campaign',destination_id:id};
  const key=sha256(['campaign',id,fingerprint]);
  const state=states.get('campaign')??{phase:'PUBLICATION_REVIEW',destinations:[],assets:{},decisions:{},deliveries:{}};
  state.destinations.push(verified(id));
  state.assets[id]={asset,fingerprint};if(decision)state.decisions[id]=approval;
  state.deliveries[id]={status:'ATTEMPTING',idempotency_key:key};states.set('campaign',state);
  return {version:'EMRADAR_V3',kind:'APPROVED_DELIVERY',campaign_id:'campaign',destination_id:id,asset,approval,idempotency_key:key};
 };
 const pool={query:async(sql,args=[])=>{
  if(sql.startsWith('SELECT payload'))return {rows:[{payload:states.get(args[0])}]};
  if(sql.startsWith('SELECT record'))return {rows:[...states.get('campaign').destinations.map(record=>({record})),...suppressed.map(record=>({record}))]};
  if(sql.includes('INSERT INTO v3_send_reservations')){
   if(receipts.has(args[0])||[...receipts.values()].some(r=>r.campaign_id===args[1]&&r.destination_id===args[2]))return {rowCount:0};
   receipts.set(args[0],{campaign_id:args[1],destination_id:args[2],status:'RESERVED'});return {rowCount:1};
  }
  if(sql.startsWith('UPDATE v3_send_reservations')){const r=receipts.get(args[0]);if(r?.status!=='RESERVED')return {rowCount:0};Object.assign(r,{status:args[1],provider_id:args[2]});return {rowCount:1};}
  throw Error('UNEXPECTED_SQL');
 }};
 let sends=0;const sentPayloads=[];
 const integration=()=>createV3PreparedIntegration({pool,token:'test'.repeat(12),reviewOrigin:'https://review.example.org',sendOwnerReview:async()=>{throw Error('NO_OWNER_EMAIL');},sendApprovedEmail:async payload=>{sends++;sentPayloads.push(structuredClone(payload));if(payload.destination_id==='fails')throw Error('SMTP_REJECTED');return {accepted:true,receipt_id:'receipt-'+payload.destination_id,sent_folder:{status:'APPENDED',folder:'Sent',uid:7}};}});
 return {states,receipts,suppressed,add,integration,sends:()=>sends,sentPayloads};
}

test('owner-approved verified address proceeds, receipt is recorded, duplicate fails after integration restart',async()=>{
 const f=await fixture(),payload=f.add('editor');
 const result=await f.integration().handle({operation:'approved-delivery',payload});
 assert.equal(result.accepted,true);assert.equal(result.sent_folder.status,'APPENDED');
 assert.deepEqual(f.receipts.get(payload.idempotency_key),{campaign_id:'campaign',destination_id:'editor',status:'ACCEPTED',provider_id:'receipt-editor'});
 await assert.rejects(f.integration().handle({operation:'approved-delivery',payload}),/V3_SEND_ALREADY_RESERVED/);assert.equal(f.sends(),1);
});

test('owner-approved recipient override delivers the exact reviewed recipient and copy once',async()=>{
 const {sha256}=await import('../vendor/emradar-v3/src/contracts.js');
 const f=await fixture(),payload=f.add('epoch'),state=f.states.get('campaign'),destination=state.destinations.find(item=>item.id==='epoch');
 const asset={...payload.asset,to:'press@epoch.ai',contact_status:'OWNER_OVERRIDE',delivery_eligible:false,recipient_owner_override:true,recipient_verification:{status:'OWNER_OVERRIDE',warning_code:'CONTACT_HTTP_403'}};
 Object.assign(destination,{contact:{email:'press@epoch.ai',purpose:null,eligible:false},contact_verified:false,delivery_eligible:false,contact_status:'OWNER_OVERRIDE',recipient_owner_override:true});
 const fingerprint=sha256(asset),approval={...payload.approval,asset_sha256:fingerprint},key=sha256(['campaign','epoch',fingerprint]);
 state.assets.epoch={asset,fingerprint};state.decisions.epoch=approval;state.deliveries.epoch={status:'ATTEMPTING',idempotency_key:key};
 Object.assign(payload,{asset,approval,idempotency_key:key});
 const result=await f.integration().handle({operation:'approved-delivery',payload});
 assert.equal(result.accepted,true);assert.equal(f.sentPayloads[0].asset.to,'press@epoch.ai');
 assert.equal(f.sentPayloads[0].asset.subject,'Article idea');assert.equal(f.sentPayloads[0].asset.body,'Evidence and possibility');
 await assert.rejects(f.integration().handle({operation:'approved-delivery',payload}),/V3_SEND_ALREADY_RESERVED/);
 assert.equal(f.sends(),1);
});

test('unapproved, rejected, address-tampered and opted-out recipients cannot reach SMTP',async()=>{
 const f=await fixture();
 for(const decision of [null,'REJECT']){
  const payload=f.add('blocked'+String(decision),decision);
  await assert.rejects(f.integration().handle({operation:'approved-delivery',payload}),/V3_OWNER_APPROVAL_REQUIRED/);
 }
 const payload=f.add('editor');
 await assert.rejects(f.integration().handle({operation:'approved-delivery',payload:{...payload,asset:{...payload.asset,to:'changed@example.org'}}}),/V3_DURABLE_APPROVAL_MISMATCH/);
 f.suppressed.push({opted_out:true});
 await assert.rejects(f.integration().handle({operation:'approved-delivery',payload}),/V3_RECIPIENT_OPTED_OUT/);
 assert.equal(f.sends(),0);assert.equal(f.receipts.size,0);
});

test('one recipient failure is isolated; unknown outcomes remain reserved and are not retried',async()=>{
 const f=await fixture(),bad=f.add('fails'),good=f.add('works');
 await assert.rejects(f.integration().handle({operation:'approved-delivery',payload:bad}),/SMTP_REJECTED/);
 assert.equal(f.receipts.get(bad.idempotency_key).status,'AMBIGUOUS');
 assert.equal((await f.integration().handle({operation:'approved-delivery',payload:good})).accepted,true);
 await assert.rejects(f.integration().handle({operation:'approved-delivery',payload:bad}),/V3_SEND_ALREADY_RESERVED/);assert.equal(f.sends(),2);
});

test('address security rejects injection, multiple recipients and local-network destinations',()=>{
 assert(validRecipient('editor+news@example.org'));
 for(const value of [null,'','editor@example.org\r\nBcc: victim@example.org','a@example.org,b@example.org','a@localhost','a@127.0.0.1','a@host.internal','a..b@example.org','a@-host.org'])assert.equal(validRecipient(value),false);
});

test('manual recipient entry cannot alter an existing approval or recipient',async()=>{
 const {CampaignStore}=await import('../vendor/emradar-v3/src/state.js');
 const original={decisions:{journal:{decision:'REJECT'}},assets:{},destinations:[],deliveries:{}};
 const store=new CampaignStore({read:async()=>({version:1,value:original}),compareAndSwap:async()=>{throw Error('MUST_NOT_WRITE');}});
 await assert.rejects(store.revise('campaign','journal','old',{to:'editor@example.org'}),/V3_VERIFIED_RECIPIENT_REQUIRED/);
 assert.equal(original.decisions.journal.decision,'REJECT');
});

test('SMTP raw bytes are also filed in Sent; filing failure never becomes an SMTP retry',async()=>{
 let rawSent,rawFiled,sends=0;
 const env={EDITORIAL_SMTP_HOST:'smtp.purelymail.com',EDITORIAL_SMTP_USER:'sean@emradar.net',EDITORIAL_SMTP_PASSWORD:'test-only',EDITORIAL_IMAP_HOST:'imap.purelymail.com'};
 const transport=()=>({verify:async()=>true,sendMail:async mail=>{sends++;rawSent=mail.raw;return {messageId:'smtp-id',accepted:[mail.envelope.to],response:'250 queued'};},close:()=>{}});
 const imap=()=>({on:()=>{},connect:async()=>{},list:async()=>[{path:'Sent',specialUse:'\\Sent',flags:new Set()}],append:async(_folder,raw)=>{rawFiled=raw;return {uid:7,uidValidity:1n};},logout:async()=>{}});
 const smtp=createV3Smtp({env,createTransport:transport,createImap:imap});
 const status=await smtp.verifyTransport();assert.equal(status.smtp,'PASS');assert.equal(status.imap,'PASS');assert.equal(sends,0);
 const payload={idempotency_key:'a'.repeat(64),asset:{kind:'EMAIL',from:'sean@emradar.net',to:'editor@example.org',subject:'Story',body:'Exact reviewed text'}};
 const sent=await smtp.sendApprovedEmail(payload);assert.equal(sent.sent_folder.status,'APPENDED');assert.deepEqual(rawSent,rawFiled);assert.equal(sends,1);
 const broken=createV3Smtp({env,createTransport:transport,createImap:()=>({...imap(),append:async()=>{throw Error('IMAP_FAILED');}})});
 const filed=await broken.sendApprovedEmail({...payload,idempotency_key:'b'.repeat(64)});assert.equal(filed.accepted,true);assert.equal(filed.receipt_id,'smtp-id');assert.equal(filed.sent_folder.status,'FAILED');assert.equal(sends,2);
});

test('review release reuses private cookie session with CSRF and ignores caller-supplied session credentials',async t=>{
 const {ReviewWorkflow}=await import('../vendor/emradar-v3/src/review-workflow.js');
 const {createReviewServer}=await import('../vendor/emradar-v3/src/http.js');
 const adapter={read:async()=>null,compareAndSwap:async()=>true};
 const workflow=new ReviewWorkflow({store:{adapter},adapter,notify:async()=>{},baseUrl:'https://review.example.org'});
 workflow.authenticate=async(campaign,id,secret)=>{assert.equal(campaign,'campaign');assert.equal(id,'session');assert.equal(secret,'private');};
 let releases=0;
 const server=createReviewServer({workflow,releaseEmail:async input=>{releases++;assert.equal(input.sessionSecret,'private');return {status:'SIMULATED_ACCEPTED'};}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const url='http://127.0.0.1:'+server.address().port+'/api/review/release';
 const run=headers=>fetch(url,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify({campaignId:'campaign',destinationId:'editor',sessionSecret:'forged'})});
 assert.equal((await run({})).status,403);
 const cookie='emradar_v3_session=session.private; emradar_v3_csrf=csrf';
 assert.equal((await run({cookie})).status,403);
 assert.equal((await run({cookie,'x-emradar-csrf':'csrf',origin:'https://other.example.org'})).status,403);
 const good=await run({cookie,'x-emradar-csrf':'csrf',origin:'https://review.example.org'});
 assert.equal(good.status,200);assert.equal(releases,1);
});

test('edit save reload binds approval and distribution payload to the persisted revision',async()=>{
 const {CampaignStore}=await import('../vendor/emradar-v3/src/state.js');
 const {ReviewWorkflow}=await import('../vendor/emradar-v3/src/review-workflow.js');
 const f=await fixture(),stale=f.add('editor'),state=f.states.get('campaign');
 delete state.deliveries.editor;state.events=[];
 state.assets.x={asset:{kind:'X',destination_id:'x',body:'Preserved X'},fingerprint:'keep-x'};
 const untouched=structuredClone(state.assets.x),destinations=structuredClone(state.destinations);
 let version=1;
 const adapter={read:async id=>({version,value:structuredClone(f.states.get(id))}),compareAndSwap:async(id,prior,next)=>{if(prior!==version)return false;version++;f.states.set(id,structuredClone(next));return true;}};
 const workflow=()=>{const store=new CampaignStore(adapter),w=new ReviewWorkflow({store,adapter,baseUrl:'https://review.example',notify:async()=>{throw Error('NO_REAL_SEND');}});w.authenticate=async()=>true;return w;};
 await workflow().revise('campaign',null,null,'editor',stale.approval.asset_sha256,{body:'Edited persisted body',subject:'Edited subject'});
 const reloaded=workflow(),view=await reloaded.view('campaign'),entry=view.entries.find(e=>e.asset.destination_id==='editor');
 assert.equal(entry.asset.body,'Edited persisted body');assert.equal(entry.asset.subject,'Edited subject');
 assert.equal(entry.revision.fingerprint,entry.fingerprint);assert(entry.revision.id);
 assert.equal(view.history[0].asset.body,stale.asset.body);assert.equal(entry.decision,null);
 assert.deepEqual(f.states.get('campaign').assets.x,untouched);assert.deepEqual(f.states.get('campaign').destinations,destinations);
 await assert.rejects(reloaded.decide('campaign',null,null,'editor','APPROVE',stale.approval.asset_sha256),/INVALID_DECISION/);
 await assert.rejects(reloaded.store.claimDelivery('campaign','editor'),/OWNER_APPROVAL_REQUIRED/);
 await reloaded.decide('campaign',null,null,'editor','APPROVE',entry.fingerprint);
 await reloaded.store.claimDelivery('campaign','editor');
 const saved=f.states.get('campaign'),payload={...stale,asset:saved.assets.editor.asset,approval:saved.decisions.editor,idempotency_key:saved.deliveries.editor.idempotency_key};
 await assert.rejects(f.integration().handle({operation:'approved-delivery',payload:stale}),/V3_DURABLE_APPROVAL_MISMATCH/);
 assert.equal((await f.integration().handle({operation:'approved-delivery',payload})).accepted,true);
 assert.equal(f.sentPayloads[0].asset.body,'Edited persisted body');assert.equal(f.sentPayloads[0].approval.asset_sha256,entry.fingerprint);
 assert.equal(f.sends(),1);
});
