const test=require('node:test'),assert=require('node:assert/strict');
const {createEmailRelay}=require('../src/emradar-email-relay');
test('relay gates authentication and verifies only the canonical SMTP identity',async()=>{
 const keys=['EMRADAR_EMAIL_RELAY_TOKEN','EDITORIAL_SMTP_HOST','EDITORIAL_SMTP_USER','EDITORIAL_SMTP_PASSWORD','EDITORIAL_SMTP_PORT','EDITORIAL_SMTP_SECURE'];
 const prior=Object.fromEntries(keys.map(key=>[key,process.env[key]]));Object.assign(process.env,{EMRADAR_EMAIL_RELAY_TOKEN:'fixture-token',EDITORIAL_SMTP_HOST:'smtp.example',EDITORIAL_SMTP_USER:'sean@emradar.net',EDITORIAL_SMTP_PASSWORD:'fixture-only',EDITORIAL_SMTP_PORT:'465',EDITORIAL_SMTP_SECURE:'true'});let sends=[];
 const relay=createEmailRelay({createTransport:()=>({verify:async()=>true,close:()=>{},sendMail:async m=>{sends.push(m);return {messageId:'test-id',accepted:[m.to]};}})});
 const body={user:'sean@emradar.net',password:'fixture-only',idempotency_key:'a'.repeat(64),mail:{from:{name:'Sean Walker',address:'sean@emradar.net'},to:'paul@im-mining.com',subject:'Reviewed subject',text:'Exact reviewed body'}};
 const call=async(b,auth='Bearer fixture-token',operation='submit')=>{const res={code:200,status(c){this.code=c;return this;},json(v){this.value=v;return this;}};await relay({headers:{authorization:auth},body:b,params:{operation}},res);return res;};
 try{
  assert.equal((await call(body,'bad')).code,403);assert.equal((await call({...body,user:'personal@gmail.com'})).code,409);assert.equal(sends.length,0);
  assert.equal((await call({...body,mail:{...body.mail,from:{...body.mail.from,name:'EMRADAR'}}})).code,409);assert.equal(sends.length,0);
  assert.equal((await call(body,undefined,'verify')).value.authenticated_user,'sean@emradar.net');assert.equal(sends.length,0);
  assert.equal((await call(body)).code,409);assert.equal(sends.length,0);
  assert.equal((await call({...body,mail:{...body.mail,text:'Changed'}})).code,409);assert.equal(sends.length,0);
 }finally{for(const key of keys){if(prior[key]===undefined)delete process.env[key];else process.env[key]=prior[key];}}
});
