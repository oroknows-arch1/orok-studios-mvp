import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import proposals from './distribution-approved-fixture.json' with {type:'json'};
const digest=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const reviewedMail=(a,r)=>({from:a.email.from,to:a.email.to,subject:a.email.subject,text:a.email.body});
const require=createRequire(import.meta.url);
const {createEmailRelay}=require('../src/emradar-email-relay.js');
const targets=proposals.filter(p=>['HYDROCARBON-ENGINEERING-EDITORIAL','RIVIERA-TANKER-EDITORIAL','TRADEWINDS-EDITORIAL'].includes(p.destination));
process.env.EDITORIAL_GMAIL_USER='oroknows@gmail.com';process.env.EDITORIAL_GMAIL_APP_PASSWORD='test';process.env.EMRADAR_EMAIL_RELAY_TOKEN='test-secret';
const sign=b=>crypto.createHmac('sha256','test-secret').update('EMRADAR_OWNER_APPROVED_DELIVERY_V1\n'+JSON.stringify({mail:b.mail,idempotency_key:b.idempotency_key,binding:b.binding})).digest('hex');
const envelope=source=>{const p=structuredClone(source);const b={user:'oroknows@gmail.com',password:'test',mail:reviewedMail(p.asset,p.asset.delivery),idempotency_key:p.publication_key,binding:{proposal:p,approval:{status:'OWNER_APPROVED',approved_by:'OWNER',proposal_id:p.proposal_id,review_hash:p.review_hash,asset_hash:digest(p.asset)}}};b.signature=sign(b);return b;};
async function relayCall(body){let calls=0;const relay=createEmailRelay({collectOutcome:()=>{},createTransport:()=>({sendMail:async m=>{calls++;return {messageId:'gmail-receipt',accepted:[m.to]};},close(){}})});let status=200,result;await relay({headers:{authorization:'Bearer test-secret'},params:{operation:'submit'},body},{status(n){status=n;return this;},json(v){result=v;return v;}});return {status,result,calls};}
for(const p of targets)test('exact approved relay envelope: '+p.destination,async()=>{const r=await relayCall(envelope(p));assert.equal(r.status,200);assert.equal(r.calls,1);});
for(const field of ['to','subject','text'])test('relay rejects substituted '+field+' even if transport payload is signed',async()=>{const b=envelope(targets[0]);b.mail[field]+=' changed';b.signature=sign(b);const r=await relayCall(b);assert.equal(r.status,409);assert.equal(r.calls,0);});
test('relay rejects forged signature and non-owner approval',async()=>{for(const mutate of [b=>b.signature='0'.repeat(64),b=>{b.binding.approval.approved_by='OTHER';b.signature=sign(b);}]){const b=envelope(targets[0]);mutate(b);assert.equal((await relayCall(b)).calls,0);}});
test('sender invariant',async()=>{const b=envelope(targets[0]);b.user='other@gmail.com';assert.equal((await relayCall(b)).calls,0);b.user='oroknows@gmail.com';b.mail.from.address='other@gmail.com';b.signature=sign(b);assert.equal((await relayCall(b)).calls,0);});
