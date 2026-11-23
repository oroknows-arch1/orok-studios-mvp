import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildCampaignEditorialPacket,auditCampaignInShadow,auditCampaignOnce} from '../src/campaign-editorial-shadow.js';

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
test('unfinished X and email placeholders do not consume the Google correction budget',()=>{
 const sample=structuredClone(state);
 sample.assets['id-0'].asset={kind:'EMAIL',subject:'Preparation incomplete: An outlet',body:'Preparation did not complete for this item. Review the persisted warning and regenerate or exclude it.',review_status:'NEEDS_REVISION'};
 sample.assets['id-1'].asset={kind:'X',subject:'X draft needs revision',body:'Editorial decision: REJECT\\nPreparation: INVESTIGATION_REQUIRED\\nDelivery: Not released',review_status:'NEEDS_REVISION'};
 const result=buildCampaignEditorialPacket(sample);
 assert.equal(result.length,14);
 assert.ok(!result.some(item=>item.id==='id-0'||item.id==='id-1'));
 assert.ok(result.some(item=>item.id==='id-2'));
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

test('free Gemini 3.5 editorial audit uses supplied evidence without paid search',async()=>{
 let calls=0;
 const result=await auditCampaignInShadow({state,model:'gemini-3.5-flash',googleSearch:false,request:async payload=>{
  calls++;
  assert.equal(payload.tools,undefined);
  assert.equal(payload.response_format.mime_type,'application/json');
  assert.equal(payload.store,false);
  return valid;
 }});
 assert.equal(calls,1);
 assert.equal(result.status,'ADVISORY');
 assert.equal(result.verdicts.length,16);
});

test('one successful Google review is durable and not repeated; asset changes get new identity',async()=>{
 const records=new Map();
 const adapter={
  async read(k){return records.get(k)??null},
  async compareAndSwap(k,version,value){
   const old=records.get(k);
   if(version===null&&old)return false;
   if(version!==null&&(!old||old.version!==version))return false;
   records.set(k,{version:(old?.version??0)+1,value});return true;
  }
 };
 const stateCopy=structuredClone(state);
 let calls=0;
 const request=async payload=>{calls++;assert.equal(payload.tools,undefined);return valid};
 const first=await auditCampaignOnce({adapter,campaignId:'test-campaign',state:stateCopy,request,model:'gemini-3.5-flash'});
 assert.equal(first.status,'ADVISORY');
 assert.equal(first.checked,16);
 assert.equal(records.get(first.recordKey).value.outcomes.length,16);
 const repeated=await auditCampaignOnce({adapter,campaignId:'test-campaign',state:stateCopy,request,model:'gemini-3.5-flash'});
 assert.equal(repeated.status,'ADVISORY');assert.equal(repeated.reused,true);assert.equal(calls,1);
 stateCopy.assets['id-0'].fingerprint='new-fingerprint';
 const changed=await auditCampaignOnce({adapter,campaignId:'test-campaign',state:stateCopy,request,model:'gemini-3.5-flash'});
 assert.equal(changed.status,'ADVISORY');assert.equal(calls,2);assert.notEqual(changed.recordKey,first.recordKey);
});

test('deployed free-tier audit defaults to no paid Google Search',async()=>{
 const payloads=[];
 const result=await auditCampaignOnce({
  adapter:{
   read:async()=>null,
   compareAndSwap:async()=>true
  },
  campaignId:'no-search-by-default',state,model:'gemini-3.5-flash',
  request:async payload=>{
   payloads.push(payload);
   return valid;
  }
 });
 assert.equal(result.status,'ADVISORY');
 assert.equal(payloads.length,1);
 assert.equal(payloads[0].tools,undefined);
});
