const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {createEmailRelay}=require('../src/emradar-email-relay');

test('owner notification accepts exact V2 replacement review URL but rejects mismatched or arbitrary links',async()=>{
 const old={};for(const key of ['EMRADAR_EMAIL_RELAY_TOKEN','EDITORIAL_SMTP_HOST','EDITORIAL_SMTP_PORT','EDITORIAL_SMTP_SECURE','EDITORIAL_SMTP_USER','EDITORIAL_SMTP_PASSWORD'])old[key]=process.env[key];
 Object.assign(process.env,{EMRADAR_EMAIL_RELAY_TOKEN:'fixture-token',EDITORIAL_SMTP_HOST:'smtp.example.test',EDITORIAL_SMTP_PORT:'465',EDITORIAL_SMTP_SECURE:'true',EDITORIAL_SMTP_USER:'sean@emradar.net',EDITORIAL_SMTP_PASSWORD:'fixture-password'});
 const sends=[];
 const relay=createEmailRelay({createTransport:()=>({sendMail:async mail=>{sends.push(mail);return {messageId:'fixture-message',accepted:['oroknows@gmail.com'],rejected:[]};},close:()=>{}})});
 const campaign_id='EMRADAR_2026_10_12_LAUNCH_REPLACEMENT_1';
 const idempotency_key=crypto.createHash('sha256').update('owner-review-notification:'+campaign_id).digest('hex');
 const notification={campaign_id,proposal_count:15,email_group_count:15,private_review_url:'https://emradar-x-executor.onrender.com/V2/CAMPAIGN_REVIEW?campaign_id='+campaign_id};
 const call=async(n,key=idempotency_key)=>{const res={code:200,status(c){this.code=c;return this;},json(v){this.value=v;return this;}};await relay({headers:{authorization:'Bearer fixture-token'},body:{notification:n,idempotency_key:key},params:{operation:'owner-notification'}},res);return res;};
 try{
  const mismatch=await call({...notification,private_review_url:notification.private_review_url.replace('REPLACEMENT_1','REPLACEMENT_2')});
  assert.equal(mismatch.code,409);assert.equal(mismatch.value.reason,'OWNER_NOTIFICATION_CONTRACT_REQUIRED');assert.equal(sends.length,0);
  const external=await call({...notification,private_review_url:'https://attacker.example.test/'});
  assert.equal(external.code,409);assert.equal(sends.length,0);
  const valid=await call(notification);assert.equal(valid.code,200);assert.equal(valid.value.message_id,'fixture-message');
  assert.equal((await call(notification)).value.message_id,'fixture-message');assert.equal(sends.length,1);
  assert.equal(sends[0].to,'oroknows@gmail.com');assert.ok(sends[0].text.includes('/V2/CAMPAIGN_REVIEW'));
 }finally{for(const [key,value] of Object.entries(old)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
});
