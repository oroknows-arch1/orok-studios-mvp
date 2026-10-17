import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {GRAPHIC_STANDARD,emradarGraphicPrompt} from '../vendor/emradar-v3/src/graphic-standard.js';
import {createOpenAiPreparationProviders} from '../vendor/emradar-v3/src/openai-preparation-providers.js';
import {CampaignPreparation} from '../vendor/emradar-v3/src/preparation.js';

const saved=JSON.parse(readFileSync(new URL('./fixtures/v3-free-state-graphic.json',import.meta.url)));
test('Free State brief retains source qualifiers, dates and geography under the deployed brand',()=>{
 const before=structuredClone(saved),prompt=emradarGraphicPrompt(saved);
 assert(prompt.includes('#031728'));assert(prompt.includes('#0862f7'));assert(prompt.includes('Segoe UI'));assert(prompt.includes('WORLD CHANGE. CONNECTED.'));
 for(const evidence of saved.document.evidence){assert(prompt.includes(evidence.fact));assert(prompt.includes(evidence.source_url));assert(prompt.includes(evidence.date));}
 assert(prompt.includes('Free State, South Africa'));assert(prompt.includes('Finance documents'));assert(prompt.includes('targets up to 8,000 EVs annually'));
 assert.match(prompt,/A shared programme may be shown as a grouping, not proof that one project powers or finances another/);
 assert.match(prompt,/never present them as achieved production/);assert.deepEqual(saved,before);
});
test('graphic brief selects only linked verified facts and does not leak unrelated context',()=>{
 const input=structuredClone(saved);
 input.document.evidence.push({id:'unsupported',record_id:'other',verified:false,fact:'Invented 99% growth'},{id:'unlinked',record_id:'other',verified:true,fact:'Unrelated finance story'});
 input.asset.evidence_ids.push('unsupported');input.document.records.push({id:'other',location:'Unrelated location'});
 const prompt=emradarGraphicPrompt(input);
 for(const value of ['Invented 99% growth','Unrelated finance story','Unrelated location'])assert(!prompt.includes(value));
});
test('one graphic standard supports different research categories without Free State or industry defaults',()=>{
 for(const [location,fact] of [['India','A semiconductor testing centre was proposed.'],['Brazil','A clinical research programme was announced.'],['Indonesia','A crop-research partnership was announced.']]){
  const prompt=emradarGraphicPrompt({asset:{body:fact,evidence_ids:['e']},document:{evidence:[{id:'e',record_id:'r',fact,verified:true}],records:[{id:'r',location}]}});
  assert(prompt.includes(location));assert(prompt.includes(fact));assert(!prompt.includes('Free State'));assert(!prompt.includes('R100'));assert(!prompt.includes('solar-panel collages')||prompt.includes('No cartoons'));
 }
});
test('production provider uses the shared standard and existing model/image byte contract without changing saved assets',async()=>{
 const input=structuredClone(saved),before=structuredClone(input),requests=[];
 const providers=createOpenAiPreparationProviders({openai:{chat:{completions:{create:async()=>{throw Error('NO_TEXT_REGENERATION');}}},images:{generate:async(request,options)=>{requests.push({request,options});return {data:[{b64_json:'cHJldmlldyBvbmx5'}]};}}}});
 assert.deepEqual(await providers.renderVisual(input),{base64:'cHJldmlldyBvbmx5'});
 assert.equal(requests.length,1);assert.equal(requests[0].request.prompt,emradarGraphicPrompt(input));assert.equal(requests[0].request.size,'1024x1024');assert.equal(requests[0].request.model,'gpt-image-1');assert.equal(requests[0].options.maxRetries,0);assert.deepEqual(input,before);
 assert.equal(GRAPHIC_STANDARD.version,'emradar-connected-world-v1');
});
test('missing source evidence retains the existing verification failure and never calls image generation',async()=>{
 let calls=0;const provider=createOpenAiPreparationProviders({openai:{chat:{completions:{create:async()=>{}}},images:{generate:async()=>{calls++;}}}});
 await assert.rejects(provider.renderVisual({asset:{evidence_ids:['unverified']},document:{evidence:[{id:'unverified',verified:false,fact:'Not verified'}]}}),/V3_X_EVIDENCE_REQUIRED/);assert.equal(calls,0);
});
test('existing PUBLICATION_REVIEW campaigns are not regenerated and their approved graphics and receipts survive',async()=>{
 const state={phase:'PUBLICATION_REVIEW',assets:{x:{asset:{...saved.asset,visual_sha256:'approved-graphic'},fingerprint:'approved'}},decisions:{x:{decision:'APPROVE',asset_sha256:'approved'}},deliveries:{email:{status:'ACCEPTED',receipt:{provider_id:'existing'}}}};
 const before=structuredClone(state);let calls=0;
 const preparation=new CampaignPreparation({store:{start:async()=>saved.asset.campaign_id,select:async()=>{throw Error('NO_SELECTION');},adapter:{read:async()=>({value:state})}},discover:async()=>{throw Error('NO_DISCOVERY');},write:async()=>{throw Error('NO_WRITING');},renderVisual:async()=>{calls++;}});
 assert.equal((await preparation.prepare({scan:{},document:saved.document})).status,'ALREADY_PREPARED');assert.equal(calls,0);assert.deepEqual(state,before);
});
