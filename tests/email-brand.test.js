const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const brand=require('../src/email-brand.cjs');
const {createEmailRelay,validBinding}=require('../src/emradar-email-relay');
const {matchOutcome}=require('../src/emradar-outcome-collector');
const digest=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
function fixture(){
 const e=brand.brand({from:{name:'Sean Walker',address:'sean@emradar.net'},to:'editor@example.test',subject:'Destination-specific subject',body:'Hi Editor,\n\nA destination-specific research question.\n\nRegards,\nSean Walker\nEMRADAR'});
 const asset={email:e,copy:`Subject: ${e.subject}\n\n${e.body}`,delivery:{public_contact_point:e.to}};
 const p={product:'EMRADAR',asset,review_binding:{product_truth:'test-source',destination:{id:'test-editor'}},signal_revision:'fixture-only',source_receipt:null,publication_key:'a'.repeat(64)};
 p.review_hash=digest({product_truth:p.review_binding.product_truth,signal_revision:p.signal_revision,asset,destination:p.review_binding.destination,source_receipt:null});p.proposal_id=digest([p.publication_key,p.review_hash]);
 const approval={approved_by:'OWNER',status:'OWNER_APPROVED',proposal_id:p.proposal_id,review_hash:p.review_hash,asset_hash:digest(asset)};
 const binding={proposal:p,approval},mail=brand.envelope(e),idempotency_key=p.publication_key;
 const signature=crypto.createHmac('sha256','fixture-token').update('EMRADAR_OWNER_APPROVED_DELIVERY_V1\n'+JSON.stringify({mail,idempotency_key,binding})).digest('hex');
 return {mail,binding,idempotency_key,signature};
}
test('relay authenticates canonical mailbox, preserves exact review binding and sends once via fake transport only',async()=>{
 const before={...process.env},sent=[],configs=[];
 Object.assign(process.env,{EMRADAR_EMAIL_RELAY_TOKEN:'fixture-token',EDITORIAL_SMTP_HOST:'smtp.example.test',EDITORIAL_SMTP_PORT:'465',EDITORIAL_SMTP_SECURE:'true',EDITORIAL_SMTP_USER:'sean@emradar.net',EDITORIAL_SMTP_PASSWORD:'fixture-not-a-secret'});
 const relay=createEmailRelay({createTransport:config=>{configs.push(config);return {verify:async()=>true,close(){},sendMail:async m=>{sent.push(m);return {messageId:'<fixture@example.test>',accepted:[m.to],rejected:[]};}};},collectOutcome:async()=>({events:[]})});
 const call=async(body,operation='submit',auth='Bearer fixture-token')=>{const res={code:200,status(c){this.code=c;return this;},json(v){this.value=v;return this;}};await relay({headers:{authorization:auth},params:{operation},body},res);return res;};
 try{
  const body=fixture();assert(validBinding(body.mail,body.idempotency_key,body.binding,body.signature,'fixture-token'));
  assert.equal((await call(body,'submit','bad')).code,403);assert.equal(sent.length,0);
  assert.equal((await call({},'verify')).value.authenticated_user,'sean@emradar.net');assert.equal(sent.length,0);
  assert.equal((await call(body)).code,200);assert.equal((await call(body)).code,200);assert.equal(sent.length,1);
  assert.equal(sent[0].text,body.mail.text);assert.equal(sent[0].html,body.mail.html);assert.equal(sent[0].replyTo,'sean@emradar.net');assert.equal(configs[0].auth.user,'sean@emradar.net');
  assert.equal((await call({...body,mail:{...body.mail,html:body.mail.html+'changed'}})).code,409);assert.equal(sent.length,1);
  delete process.env.EDITORIAL_SMTP_PASSWORD;assert.equal((await call(body)).value.reason,'CANONICAL_SMTP_CONFIGURATION_REQUIRED');assert.equal(sent.length,1);
 }finally{for(const k of Object.keys(process.env))if(!(k in before))delete process.env[k];Object.assign(process.env,before);}
});
test('canonical replies retain exact original receipt matching; legacy Gmail receipts still match their own mailbox',()=>{
 const r={message_id:'<source@example.test>',submitted_at:'2026-10-01T00:00:00Z',recipient:'editor@example.test'};
 const parsed={date:new Date('2026-10-02'),inReplyTo:r.message_id,messageId:'<reply@example.test>',from:{value:[{address:r.recipient}]},to:{value:[{address:'sean@emradar.net'}]}};
 assert.equal(matchOutcome(parsed,r,'fixture','sean@emradar.net').state,'RESPONSE_RECEIVED');assert.equal(matchOutcome(parsed,r,'fixture'),null);
 parsed.to.value[0].address='oroknows@gmail.com';assert.equal(matchOutcome(parsed,r,'fixture').state,'RESPONSE_RECEIVED');
});
