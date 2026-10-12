const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const brand=require('../src/email-brand.cjs');
const {createEmailRelay}=require('../src/emradar-email-relay');
const digest=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');

test('V2 exact reviewed email envelope and signed owner approval are required before SMTP',async()=>{
 const keys=['EMRADAR_EMAIL_RELAY_TOKEN','EDITORIAL_SMTP_HOST','EDITORIAL_SMTP_PORT','EDITORIAL_SMTP_SECURE','EDITORIAL_SMTP_USER','EDITORIAL_SMTP_PASSWORD'];
 const old=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 Object.assign(process.env,{EMRADAR_EMAIL_RELAY_TOKEN:'fixture-token',EDITORIAL_SMTP_HOST:'smtp.example.test',EDITORIAL_SMTP_PORT:'465',EDITORIAL_SMTP_SECURE:'true',EDITORIAL_SMTP_USER:'sean@emradar.net',EDITORIAL_SMTP_PASSWORD:'fixture-password'});
 let sends=0;
 const relay=createEmailRelay({createTransport:()=>({sendMail:async mail=>{sends++;return {messageId:'fixture-id',accepted:[mail.to],rejected:[]};},close:()=>{}})});
 const email=brand.brand({to:'editor@example.test',subject:'Evidence-led contribution',body:'Hello editor,\\n\\nA relevant evidence-based development.\\n\\nSean Walker\\nEMRADAR'});
 const asset={email,copy:'Subject: '+email.subject+'\\n\\n'+email.body,delivery:{public_contact_point:email.to}};
 const delivery_key='d'.repeat(64);
 const bindingData={campaign_id:'EMRADAR_2026_10_12_LAUNCH_REPLACEMENT_1',asset};
 const review_hash=digest(bindingData);
 const proposal={proposal_id:digest([delivery_key,review_hash]),review_hash,delivery_key,campaign_id:bindingData.campaign_id,binding:bindingData,asset,status:'OWNER_APPROVED'};
 const approval={authority:'OWNER',decision:'APPROVE',proposal_id:proposal.proposal_id,review_hash};
 const binding={version:'EMRADAR_OWNER_APPROVED_DELIVERY_V2',proposal,approval};
 const mail=brand.envelope(email);
 const signature=crypto.createHmac('sha256','fixture-token').update('EMRADAR_OWNER_APPROVED_DELIVERY_V1\\n'+JSON.stringify({mail,idempotency_key:delivery_key,binding})).digest('hex');
 const body={mail,idempotency_key:delivery_key,binding,signature};
 const call=async b=>{const res={code:200,status(c){this.code=c;return this;},json(v){this.value=v;return this;}};await relay({headers:{authorization:'Bearer fixture-token'},params:{operation:'submit'},body:b},res);return res;};
 try{
  const bad=await call({...body,signature:'0'.repeat(64)});assert.equal(bad.code,409);assert.equal(bad.value.reason,'REVIEWED_EMAIL_ENVELOPE_REQUIRED');assert.equal(sends,0);
  const accepted=await call(body);assert.equal(accepted.code,200);assert.equal(accepted.value.messageId,'fixture-id');
  assert.equal((await call(body)).value.messageId,'fixture-id');assert.equal(sends,1);
 }finally{for(const [key,value] of Object.entries(old)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
});
