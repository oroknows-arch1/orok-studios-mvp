'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createV3Smtp}=require('../src/emradar-v3-smtp.cjs');

test('V3 SMTP adapter preserves canonical identity and returns simulated receipts',async()=>{
 const mails=[];let closed=0;
 const adapter=createV3Smtp({env:{EDITORIAL_SMTP_HOST:'smtp.example.org',EDITORIAL_SMTP_USER:'sean@emradar.net',EDITORIAL_SMTP_PASSWORD:'test-only'},
 createTransport:()=>({sendMail:async mail=>{mails.push(mail);return {messageId:'mock-'+mails.length,accepted:[mail.to]};},close:()=>{closed++;}})});
 const owner=await adapter.sendOwnerReview({to:'oroknows@gmail.com',private_review_url:'https://example.org/review/access#token=example'});
 assert.equal(owner.provider_id,'mock-1');
 const receipt=await adapter.sendApprovedEmail({asset:{kind:'EMAIL',from:'sean@emradar.net',to:'editor@example.org',subject:'Research',body:'Evidence'},idempotency_key:'a'.repeat(64)});
 assert.equal(receipt.receipt_id,'mock-2');
 assert.equal(mails[1].from.address,'sean@emradar.net');
 assert.equal(mails[1].headers['X-EMRADAR-Idempotency-Key'],'a'.repeat(64));
 assert.equal(closed,2);
 await assert.rejects(adapter.sendApprovedEmail({asset:{kind:'EMAIL',from:'wrong@example.org',to:'editor@example.org',subject:'Research',body:'Evidence'}}),/V3_EMAIL_ASSET_INVALID/);
 assert.equal(mails.length,2);
});
