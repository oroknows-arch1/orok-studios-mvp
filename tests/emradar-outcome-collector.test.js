const test=require('node:test'),assert=require('node:assert/strict');
const {createOutcomeCollector,matchOutcome}=require('../src/emradar-outcome-collector');
const r={id:'a'.repeat(64),message_id:'<original@gmail.com>',recipient:'editor@example.com',submitted_at:'2026-10-05T22:00:00Z'};
const reply=()=>({date:new Date('2026-10-06T00:00:00Z'),messageId:'<reply@example.com>',inReplyTo:r.message_id,from:{value:[{address:r.recipient}]},to:{value:[{address:'oroknows@gmail.com'}]},headers:new Map()});
test('Gmail matching rejects arbitrary inbox mail, wrong recipient, old timestamps and sentiment inference',()=>{
 const p=reply();assert.equal(matchOutcome(p,r,'gmail:1').state,'RESPONSE_RECEIVED');assert.equal(matchOutcome({...p,inReplyTo:'<unrelated@gmail.com>'},r,'gmail:1'),null);assert.equal(matchOutcome({...p,from:{value:[{address:'other@example.com'}]}},r,'gmail:1'),null);assert.equal(matchOutcome({...p,date:new Date('2025-01-01')},r,'gmail:1'),null);assert.equal(matchOutcome(p,r,'gmail:1').evidence.classification,'RESPONSE_ONLY_NO_SENTIMENT_INFERENCE');
});
test('DSN requires exact original message, recipient block, failed action and permanent failure code',()=>{
 const p=reply();p.inReplyTo=null;p.attachments=[{contentType:'message/delivery-status',content:Buffer.from('Reporting-MTA: dns; example.com\r\n\r\nFinal-Recipient: rfc822; editor@example.com\r\nAction: failed\r\nStatus: 5.1.1')},{contentType:'text/rfc822-headers',content:Buffer.from('Message-ID: '+r.message_id)}];assert.equal(matchOutcome(p,r,'gmail:2').state,'BOUNCED');p.attachments[0].content=Buffer.from('Final-Recipient: rfc822; another@example.com\r\nAction: failed\r\nStatus: 5.1.1');assert.equal(matchOutcome(p,r,'gmail:2'),null);
});
test('collector is bounded/read-only, has no send capability and preserves no-response semantics',async()=>{
 let locks=[],closed=0;const collect=createOutcomeCollector({createClient:()=>({connect:async()=>{},list:async()=>[{path:'All Mail',specialUse:'\\All'}],getMailboxLock:async(path,options)=>{locks.push([path,options]);return {release(){}};},mailbox:{uidValidity:1},search:async()=>[],logout:async()=>closed++,close:()=>closed++})});
 const result=await collect({user:'oroknows@gmail.com',password:'fixture',receipt:r});assert.equal(result.collection.complete,true);assert.deepEqual(result.events,[]);assert.equal(locks[0][1].readOnly,true);assert.equal(closed,1);await assert.rejects(collect({user:'wrong@gmail.com',password:'fixture',receipt:r}),/RECEIPT/);
});
