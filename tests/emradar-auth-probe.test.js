"use strict";
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const env={RENDER_SERVICE_ID:'srv-d79k9os50q8c73fkeqig',EDITORIAL_SMTP_HOST:'smtp.example.test',EDITORIAL_SMTP_USER:'sean@emradar.net',EDITORIAL_SMTP_PASSWORD:'TEST_SECRET_NEVER_OUTPUT',EDITORIAL_IMAP_HOST:'imap.example.test'};
function fresh(){delete require.cache[require.resolve('../src/emradar-auth-probe')];return require('../src/emradar-auth-probe');}
function harness(error){
 const calls=[],logs=[];
 return {calls,logs,options:{env,now:()=>0,log:x=>logs.push(x),
 createTransport:o=>{assert.equal(o.logger,false);assert.equal(o.debug,false);assert.equal(o.auth.pass,env.EDITORIAL_SMTP_PASSWORD);return {verify:async()=>{calls.push('SMTP_AUTH');if(error)throw error;},close:()=>calls.push('SMTP_CLOSE')};},
 createImap:o=>{assert.equal(o.logger,false);assert.equal(o.logRaw,false);assert.equal(o.auth.user,'sean@emradar.net');return {on:()=>{},connect:async()=>calls.push('IMAP_AUTH'),logout:async()=>calls.push('IMAP_LOGOUT')};}}};
}
test('production authentication only, env credentials, disconnect, sanitized output and once per process',async()=>{
 const p=fresh(),h=harness();const r=await p.runAuthenticationProbe(h.options);
 assert.equal(r.smtp,'PASS');assert.equal(r.imap,'PASS');assert.equal(r.emails_sent,0);assert.equal(r.external_actions,0);
 assert.deepEqual(h.calls,['SMTP_AUTH','SMTP_CLOSE','IMAP_AUTH','IMAP_LOGOUT']);
 assert(!h.logs.join('').includes(env.EDITORIAL_SMTP_PASSWORD));
 assert.equal(await p.runAuthenticationProbe(h.options),null);
});
test('SMTP failure is sanitized and stops IMAP',async()=>{
 const p=fresh(),h=harness(Object.assign(new Error(env.EDITORIAL_SMTP_PASSWORD),{code:'EAUTH',response:env.EDITORIAL_SMTP_PASSWORD}));
 const r=await p.runAuthenticationProbe(h.options);assert.equal(r.smtp_reason,'AUTHENTICATION_REJECTED');
 assert.equal(r.imap_reason,'NOT_ATTEMPTED_SMTP_FAILED');assert.deepEqual(h.calls,['SMTP_AUTH','SMTP_CLOSE']);
 assert(!h.logs.join('').includes(env.EDITORIAL_SMTP_PASSWORD));
});
test('IMAP rejection is sanitized and connection closes',async()=>{
 const p=fresh(),h=harness();h.options.createImap=()=>({on:()=>{},connect:async()=>{throw Object.assign(new Error(env.EDITORIAL_SMTP_PASSWORD),{authenticationFailed:true});},logout:async()=>h.calls.push('IMAP_LOGOUT')});
 const r=await p.runAuthenticationProbe(h.options);assert.equal(r.smtp,'PASS');assert.equal(r.imap,'FAIL');assert.equal(r.imap_reason,'AUTHENTICATION_REJECTED');assert(h.calls.includes('IMAP_LOGOUT'));assert(!h.logs.join('').includes(env.EDITORIAL_SMTP_PASSWORD));
});
test('hard expiry disables diagnostic without a second deployment',async()=>{
 const p=fresh(),h=harness();h.options.now=()=>p.EXPIRES_AT;assert.equal(await p.runAuthenticationProbe(h.options),null);assert.deepEqual(h.calls,[]);assert.deepEqual(h.logs,[]);
});
test('test and other services cannot execute diagnostic',async()=>{
 for(const extra of [{NODE_ENV:'test'},{RENDER_SERVICE_ID:'another-service'}]){
 const p=fresh(),h=harness();h.options.env={...env,...extra};assert.equal(await p.runAuthenticationProbe(h.options),null);assert.deepEqual(h.calls,[]);
 }
});
test('invalid canonical configuration cannot authenticate',async()=>{
 const p=fresh(),h=harness();h.options.env={...env,EDITORIAL_SMTP_USER:'legacy@example.test'};
 const r=await p.runAuthenticationProbe(h.options);assert.equal(r.reason,'CANONICAL_MAILBOX_CONFIGURATION_REQUIRED');assert.deepEqual(h.calls,[]);
});
test('diagnostic has no message, mailbox or distribution operations',()=>{
 const source=fs.readFileSync(require.resolve('../src/emradar-auth-probe'),'utf8');
 assert(!/sendMail|append\(|mailboxOpen|fetch\(|collectOutcome|createEmailRelay|PUBLICATION_REVIEW/.test(source));
});
