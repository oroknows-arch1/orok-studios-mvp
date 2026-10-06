const test=require('node:test'),assert=require('node:assert/strict');
const {createEmailRelay}=require('../src/emradar-email-relay');
test('relay gates sender/auth and sends exact envelope once per idempotency key',async()=>{
 const prior=process.env.EMRADAR_EMAIL_RELAY_TOKEN;process.env.EMRADAR_EMAIL_RELAY_TOKEN='fixture-token';let sends=[];
 const relay=createEmailRelay({createTransport:()=>({verify:async()=>true,close:()=>{},sendMail:async m=>{sends.push(m);return {messageId:'test-id',accepted:[m.to]};}})});
 const body={user:'oroknows@gmail.com',password:'fixture-only',idempotency_key:'a'.repeat(64),mail:{from:{name:'Sean Walker',address:'oroknows@gmail.com'},to:'paul@im-mining.com',subject:'Reviewed subject',text:'Exact reviewed body'}};
 const call=async(b,auth='Bearer fixture-token',operation='submit')=>{const res={code:200,status(c){this.code=c;return this;},json(v){this.value=v;return this;}};await relay({headers:{authorization:auth},body:b,params:{operation}},res);return res;};
 try{
  assert.equal((await call(body,'bad')).code,403);assert.equal((await call({...body,user:'personal@gmail.com'})).code,409);assert.equal(sends.length,0);
  assert.equal((await call({...body,mail:{...body.mail,from:{...body.mail.from,name:'EMRADAR'}}})).code,409);assert.equal(sends.length,0);
  assert.equal((await call(body,undefined,'verify')).value.authenticated_user,'oroknows@gmail.com');assert.equal(sends.length,0);
  assert.equal((await call(body)).value.messageId,'test-id');assert.equal((await call(body)).value.messageId,'test-id');assert.equal(sends.length,1);assert.equal(sends[0].text,body.mail.text);assert.equal(sends[0].subject,body.mail.subject);
  assert.equal((await call({...body,mail:{...body.mail,text:'Changed'}})).code,409);assert.equal(sends.length,1);
 }finally{if(prior===undefined)delete process.env.EMRADAR_EMAIL_RELAY_TOKEN;else process.env.EMRADAR_EMAIL_RELAY_TOKEN=prior;}
});
