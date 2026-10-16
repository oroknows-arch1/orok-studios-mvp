'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {runOwnerInvitationOnce}=require('../src/emradar-v3-runtime.cjs');
const {createV3Smtp}=require('../src/emradar-v3-smtp.cjs');

test('one fresh invitation replaces consumed access, preserves campaign and is not resent on restart',async()=>{
 const {ReviewWorkflow}=await import('../vendor/emradar-v3/src/review-workflow.js');
 const campaign={phase:'PUBLICATION_REVIEW',decisions:{journal:{decision:'REJECT'},x:{decision:'APPROVE'}},assets:{x:{asset:{body:'Preserved'}}}};
 const records=new Map([['campaign',{version:1,value:structuredClone(campaign)}],['review:campaign',{version:1,value:{campaign_id:'campaign',status:'CONSUMED',expires_at:2000,consumed_at:900,token_hash:'old',owner_session:{id:'old-session'},notification_receipt:{recipient:'oroknows@gmail.com'}}}]]);
 const adapter={read:async key=>structuredClone(records.get(key)??null),compareAndSwap:async(key,version,value)=>{const old=records.get(key);if((old?.version??null)!==version)return false;records.set(key,{version:(version??0)+1,value:structuredClone(value)});return true;}};
 let sends=0,inspections=0,link;
 const workflow=new ReviewWorkflow({store:{adapter},adapter,baseUrl:'https://review.example.org',clock:()=>1000,notify:async input=>{sends++;link=input.link;assert.equal(input.recipient,'sean@emradar.net');return {accepted:true,provider_id:'owner-mail',recipient:input.recipient,campaign_id:input.campaignId};}});
 const run=()=>runOwnerInvitationOnce({adapter,workflow,campaignId:'campaign',reviewOrigin:'https://review.example.org',key:'invitation-once',inspectInbox:async input=>{inspections++;assert.equal(input.token_hash,crypto.createHash('sha256').update(new URLSearchParams(new URL(link).hash.slice(1)).get('token')).digest('hex'));return {status:'PASS',link_ready:true,inbox_uid:42};}});
 assert.equal((await run()).status,'OWNER_REVIEW_READY');assert.equal((await run()).status,'RELEASE_ALREADY_EXECUTED');assert.equal(sends,1);assert.equal(inspections,1);
 const review=(await adapter.read('review:campaign')).value;
 assert.equal(review.status,'NOTIFIED');assert.equal(review.consumed_at,null);assert.equal(review.owner_session,null);assert.equal(review.previous_reviews[0].status,'CONSUMED');
 assert.deepEqual((await adapter.read('campaign')).value,campaign);
 await assert.rejects(workflow.authenticate('campaign','old-session','old-secret'),/OWNER_SESSION_REQUIRED/);
});

test('IMAP confirms exact invitation and private token without consuming or following its link',async()=>{
 const token='private-test-token',campaignId='v3-test',provider_id='<owner-message@emradar.net>';
 const link='https://review.example.org/review/access#token='+token+'&campaign='+campaignId;
 let url=link,reads=0,sends=0;
 const env={EDITORIAL_SMTP_HOST:'smtp.purelymail.com',EDITORIAL_SMTP_USER:'sean@emradar.net',EDITORIAL_SMTP_PASSWORD:'test-only',EDITORIAL_IMAP_HOST:'imap.purelymail.com'};
 const smtp=createV3Smtp({env,createTransport:()=>({sendMail:async()=>{sends++;throw Error('NO_SEND');}}),createImap:()=>({on:()=>{},connect:async()=>{},getMailboxLock:async(path,options)=>{assert.equal(path,'INBOX');assert.equal(options.readOnly,true);return {release:()=>{}};},search:async query=>{assert.equal(query.header['message-id'],provider_id);return [42];},fetchOne:async()=>{reads++;return {source:Buffer.from('From: sean@emradar.net\r\nTo: sean@emradar.net\r\nMessage-ID: '+provider_id+'\r\nSubject: EMRADAR private campaign review\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nYour private EMRADAR campaign review link:\r\n'+url+'\r\n')};},logout:async()=>{}})});
 const input={provider_id,campaignId,reviewOrigin:'https://review.example.org',token_hash:crypto.createHash('sha256').update(token).digest('hex')};
 assert.deepEqual(await smtp.inspectOwnerInvitation(input),{status:'PASS',inbox_uid:42,message_id:provider_id,link_ready:true});
 url=url.replace('review.example.org','wrong.example.org');assert.equal((await smtp.inspectOwnerInvitation(input)).status,'FAIL');
 await assert.rejects(smtp.sendOwnerReview({to:'oroknows@gmail.com',private_review_url:link}),/V3_OWNER_MAIL_INVALID/);
 assert.equal(reads,2);assert.equal(sends,0);
});
