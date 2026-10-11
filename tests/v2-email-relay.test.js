const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
// Collection is outside this submit-only regression; all sends use injected transport.
require.cache[require.resolve('../src/emradar-outcome-collector')]={exports:{createOutcomeCollector:()=>async()=>({events:[]})}};
const {createEmailRelay,validBinding}=require('../src/emradar-email-relay');
const brand=require('../src/email-brand.cjs');
const hash=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const sign=b=>crypto.createHmac('sha256','fixture').update('EMRADAR_OWNER_APPROVED_DELIVERY_V1\n'+JSON.stringify({mail:b.mail,idempotency_key:b.idempotency_key,binding:b.binding})).digest('hex');
function fixture(v2=true){
 const email=brand.brand({to:'editor@example.test',subject:'Approved subject',body:'Hello,\n\nApproved correspondence.\n\nSean Walker\nEMRADAR'}),asset={email,copy:`Subject: ${email.subject}\n\n${email.body}`,delivery:{public_contact_point:email.to}},campaign_id='EMRADAR_2026_10_10_LAUNCH',idempotency_key='a'.repeat(64);
 let proposal,approval;
 if(v2){const binding={campaign_id,asset};const review_hash=hash(binding),proposal_id=hash([idempotency_key,review_hash]);proposal={proposal_id,review_hash,delivery_key:idempotency_key,campaign_id,asset,binding,status:'OWNER_APPROVED'};approval={proposal_id,review_hash,authority:'OWNER',decision:'APPROVE',decided_at:'2026-10-10T00:00:00Z'};}
 else{const review_binding={product_truth:'fixture',destination:{id:'editor'}},signal_revision='r1',review_hash=hash({product_truth:'fixture',signal_revision,asset,destination:review_binding.destination,source_receipt:null}),proposal_id=hash([idempotency_key,review_hash]);proposal={proposal_id,review_hash,publication_key:idempotency_key,product:'EMRADAR',asset,review_binding,signal_revision};approval={proposal_id,review_hash,approved_by:'OWNER',status:'OWNER_APPROVED',asset_hash:hash(asset)};}
 const b={mail:brand.envelope(email),idempotency_key,binding:{...(v2?{version:'EMRADAR_OWNER_APPROVED_DELIVERY_V2'}:{}),proposal,approval}};b.signature=sign(b);return b;
}
test('V2 relay preserves authentication, exact approved email, V1 compatibility and idempotency',async()=>{
 const saved={...process.env};Object.assign(process.env,{EMRADAR_EMAIL_RELAY_TOKEN:'fixture',EDITORIAL_SMTP_HOST:'smtp.example.test',EDITORIAL_SMTP_PORT:'465',EDITORIAL_SMTP_SECURE:'true',EDITORIAL_SMTP_USER:'sean@emradar.net',EDITORIAL_SMTP_PASSWORD:'fixture'});
 try{
 let calls=0,release;const relay=createEmailRelay({collectOutcome:async()=>({events:[]}),createTransport:()=>({close(){},sendMail:async mail=>{calls++;await new Promise(r=>release=r);return {messageId:'provider-receipt',accepted:[mail.to]};}})});
 const call=async(body,auth='Bearer fixture')=>{const res={code:200,status(code){this.code=code;return this;},json(value){this.value=value;return this;}};await relay({headers:{authorization:auth},params:{operation:'submit'},body},res);return res;};
 const b=fixture();assert(validBinding(b.mail,b.idempotency_key,b.binding,b.signature,'fixture'));const legacy=fixture(false);assert(validBinding(legacy.mail,legacy.idempotency_key,legacy.binding,legacy.signature,'fixture'));
 assert.equal((await call(b,'bad')).code,403);
 for(const mutate of [x=>x.signature='0'.repeat(64),x=>{x.binding.approval.decision='REJECT';x.signature=sign(x);},x=>{x.mail.text+=' changed';x.signature=sign(x);},x=>{x.binding.proposal.asset.email.to='other@example.test';x.signature=sign(x);}]){const changed=structuredClone(b);mutate(changed);assert.equal((await call(changed)).code,409);}
 assert.equal(calls,0);const first=call(b);while(!release)await new Promise(r=>setImmediate(r));const second=call(b);release();const responses=await Promise.all([first,second]);assert.equal(calls,1);for(const response of responses){assert.equal(response.code,200);assert.equal(response.value.messageId,'provider-receipt');}assert.equal((await call(b)).value.messageId,'provider-receipt');assert.equal(calls,1);
 }finally{for(const k of Object.keys(process.env))if(!(k in saved))delete process.env[k];Object.assign(process.env,saved);}
});
test('relay transport failure releases the request for recovery without changing its identity',async()=>{
 const saved={...process.env};Object.assign(process.env,{EMRADAR_EMAIL_RELAY_TOKEN:'fixture',EDITORIAL_SMTP_HOST:'smtp.example.test',EDITORIAL_SMTP_USER:'sean@emradar.net',EDITORIAL_SMTP_PASSWORD:'fixture'});
 try{let calls=0;const relay=createEmailRelay({collectOutcome:async()=>({events:[]}),createTransport:()=>({close(){},sendMail:async mail=>{if(++calls===1)throw Error('rejected before send');return {messageId:'recovered',accepted:[mail.to]};}})}),b=fixture();const call=async()=>{const res={code:200,status(code){this.code=code;return this;},json(value){this.value=value;return this;}};await relay({headers:{authorization:'Bearer fixture'},params:{operation:'submit'},body:b},res);return res;};assert.equal((await call()).code,409);assert.equal((await call()).value.messageId,'recovered');assert.equal(calls,2);assert.equal((await call()).value.messageId,'recovered');assert.equal(calls,2);
 }finally{for(const k of Object.keys(process.env))if(!(k in saved))delete process.env[k];Object.assign(process.env,saved);}
});
