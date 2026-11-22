import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildCampaignEditorialPacket,auditCampaignInShadow} from '../src/campaign-editorial-shadow.js';

const state={assets:Object.fromEntries(Array.from({length:16},(_,i)=>['id-'+i,{fingerprint:'sha-'+i,asset:{subject:'Subject',body:'Proposal '+i,recipient_email:'SECRET'}}])),
 destinations:Array.from({length:16},(_,i)=>({id:'id-'+i,name:'Publisher '+i,evidence:{ids:['source']},contact:{email:'PRIVATE@EXAMPLE.COM'}})),
 preparation_input:{document:{evidence:[{id:'source',verified:true,source_url:'https://example.com/notice'}]}}};
const packet=buildCampaignEditorialPacket(state);
const valid={proposals:packet.map(p=>({id:p.id,verdict:'CORRECT',reason:'Improve recipient fit',correction:'Specific correction',sourceUrls:[]}))};

test('one packet includes all 16 drafts, fingerprints and sources but no private contacts',()=>{
 assert.equal(packet.length,16);
 assert.equal(packet[0].sourceUrls[0],'https://example.com/notice');
 assert.ok(!JSON.stringify(packet).includes('PRIVATE@EXAMPLE.COM'));
 assert.ok(!JSON.stringify(packet).includes('SECRET'));
});
test('one request returns 16 advisory results; saved campaign unchanged',async()=>{
 let calls=0;const before=JSON.stringify(state);
 const result=await auditCampaignInShadow({state,model:'test-model',request:async input=>{
  calls++;assert.equal(input.store,false);assert.equal(input.tools[0].type,'google_search');
  assert.equal(JSON.parse(input.input.slice(input.input.indexOf('['))).length,16);return valid;
 }});
 assert.equal(calls,1);assert.equal(result.status,'ADVISORY');assert.equal(result.verdicts.length,16);
 assert.equal(JSON.stringify(state),before);
});
test('partial, duplicate or unknown verdicts are not accepted',async()=>{
 const bad=[valid.proposals.slice(1),[...valid.proposals.slice(1),valid.proposals[1]],[...valid.proposals.slice(1),{...valid.proposals[0],id:'unknown'}]];
 for(const proposals of bad)assert.equal((await auditCampaignInShadow({state,request:async()=>({proposals})})).status,'UNUSABLE_AUDIT');
});
test('provider unavailable never blocks and does not alter saved campaign',async()=>{
 const before=JSON.stringify(state);
 assert.equal((await auditCampaignInShadow({state,request:async()=>{throw Error('offline')}})).status,'AUDITOR_UNAVAILABLE');
 assert.equal(JSON.stringify(state),before);
});

test('Gemini 2.5 search request omits unsupported strict schema but retains 16 verdicts',async()=>{
 let captured;
 const result=await auditCampaignInShadow({state,model:'gemini-2.5-flash',request:async payload=>{
  captured=payload;return valid;
 }});
 assert.equal(result.status,'ADVISORY');
 assert.equal(result.verdicts.length,16);
 assert.equal(captured.response_format,undefined);
 assert.deepEqual(captured.tools,[{type:'google_search'}]);
 assert.match(captured.input,/Return ONLY a JSON object/);
});
