import test from 'node:test';
import assert from 'node:assert/strict';
import {CampaignStore} from '../vendor/emradar-v3/src/state.js';
import {prepareEditorialAlternatives} from '../vendor/emradar-v3/src/editorial-alternatives.js';
import {createOpenAiPreparationProviders} from '../vendor/emradar-v3/src/openai-preparation-providers.js';

function fixture(){
 let state={id:'campaign',phase:'PUBLICATION_REVIEW',scan:{source_key:'kept'},destinations:[{id:'journal',name:'African Energy',destination_class:'EDITORIAL_PUBLICATION',evidence:{ids:['e1']}}],preparation_input:{document:{evidence:[{id:'e1',verified:true,fact:'Proposed energy and manufacturing projects.'}]}},assets:{journal:{fingerprint:'old-email',asset:{campaign_id:'campaign',destination_id:'journal',kind:'EMAIL',correspondence_type:'EDITORIAL_OUTREACH',body:'Old email',evidence_limitations:'Plans do not establish completed projects.'}},x:{fingerprint:'keep-x',asset:{kind:'X',body:'Saved X',visual_base64:'saved-image'}}},decisions:{journal:{decision:'APPROVE'},x:{decision:'APPROVE'}},deliveries:{},events:[]};
 let version=1;
 const adapter={read:async()=>({version,value:structuredClone(state)}),compareAndSwap:async(_id,expected,value)=>{if(expected!==version)return false;version++;state=structuredClone(value);return true;}};
 return {store:new CampaignStore(adapter),read:()=>structuredClone(state)};
}
const email=({campaignId,destination})=>({campaign_id:campaignId,destination_id:destination.id,kind:'EMAIL',correspondence_type:'EDITORIAL_OUTREACH',subject:'Article idea',body:'Would an article about these plans interest you?',from:'sean@emradar.net',to:null,delivery_eligible:false,contact_status:'UNVERIFIED',evidence_ids:['e1']});

test('rejects old editorial approval before writing; saves two pending alternatives and reuses on restart',async()=>{
 const f=fixture(),before=f.read();let calls=0;
 const run=()=>prepareEditorialAlternatives({store:f.store,campaignId:'campaign',requestId:'request',angles:['Energy and factories','Plans becoming projects'],write:async input=>{
  calls++;assert.equal(f.read().decisions.journal.decision,'REJECT');
  assert.deepEqual(input.document.uncertainty,['Plans do not establish completed projects.']);
  return {...email(input),subject:input.editorialAngle};
 }});
 assert.equal((await run()).variants,2);await run();assert.equal(calls,2);
 const after=f.read();assert.deepEqual(after.assets,before.assets);assert.deepEqual(after.scan,before.scan);assert.deepEqual(after.preparation_input,before.preparation_input);assert.deepEqual(after.decisions.x,before.decisions.x);assert.deepEqual(after.deliveries,{});
 assert.equal(after.editorial_rewrite.rejected[0].previous_decision.decision,'APPROVE');
 assert.equal(after.editorial_rewrite.rejected[0].rejection.decision,'REJECT');
 assert(after.editorial_rewrite.variants.every(v=>v.status==='OWNER_REVIEW'&&v.asset.to===null));
});

test('provider failure preserves rejection and first completed sample without retrying either',async()=>{
 const f=fixture();let calls=0;
 const options={store:f.store,campaignId:'campaign',requestId:'request',angles:['one','two'],write:async input=>{if(++calls===2)throw Error('PROVIDER_UNAVAILABLE');return email(input);}};
 await assert.rejects(prepareEditorialAlternatives(options),/PROVIDER_UNAVAILABLE/);
 assert.equal(f.read().editorial_rewrite.variants.length,1);assert.equal(f.read().decisions.journal.decision,'REJECT');
 assert.equal((await prepareEditorialAlternatives(options)).status,'FAILED');assert.equal(calls,2);
});

test('already distributed editorial assets cannot be rewritten',async()=>{
 const f=fixture();await f.store.mutate('campaign',s=>{s.deliveries.journal={status:'ACCEPTED'};return s;});
 await assert.rejects(prepareEditorialAlternatives({store:f.store,campaignId:'campaign',requestId:'request',angles:['one','two'],write:async()=>{throw Error('NO_WRITE');}}),/REVISION_AFTER_DISTRIBUTION/);
});

test('active writer receives plain-language direction, actual publication relevance and only linked evidence',async()=>{
 let request;
 const providers=createOpenAiPreparationProviders({openai:{chat:{completions:{create:async input=>{request=input;return {choices:[{message:{content:JSON.stringify({subject:'Article idea',body:'I’m Sean Walker at EMRADAR. Could we contribute an article about these proposed projects?',limitations:'Projects are proposed.'})}}]};}}},images:{generate:async()=>{throw Error('NO_IMAGES');}}}});
 const asset=await providers.write({campaignId:'campaign',destination:{id:'journal',name:'African Energy',destination_class:'EDITORIAL_PUBLICATION',relationship:{reason:'Reports on African energy industries.'},evidence:{ids:['e1']},contact_verified:false},document:{evidence:[{id:'e1',verified:true,fact:'Proposed energy project.'},{id:'e2',verified:true,fact:'Unrelated story.'},{id:'e3',verified:false,fact:'Unverified story.'}]},editorialAngle:'Follow the announced energy plans'});
 const payload=JSON.parse(request.messages[1].content);
 assert.match(request.messages[0].content,/plain everyday English/);assert.match(request.messages[0].content,/Omit financial totals/);
 assert.equal(payload.destination.relationship.reason,'Reports on African energy industries.');assert.deepEqual(payload.evidence.map(e=>e.id),['e1']);assert.equal(payload.editorial_angle,'Follow the announced energy plans');assert.equal(asset.delivery_eligible,false);assert.equal(asset.to,null);
});
