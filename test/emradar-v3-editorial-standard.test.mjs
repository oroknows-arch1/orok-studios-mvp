import verified from './fixtures/v3-verified-recipient.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {EDITORIAL_REFERENCE,originalOutreach} from '../vendor/emradar-v3/src/editorial-reference.js';
import {createOpenAiPreparationProviders} from '../vendor/emradar-v3/src/openai-preparation-providers.js';
import {refreshUnreviewedEditorialDrafts} from '../vendor/emradar-v3/src/editorial-standard-refresh.js';
import {CampaignStore} from '../vendor/emradar-v3/src/state.js';
import {CampaignPreparation} from '../vendor/emradar-v3/src/preparation.js';

const evidence=[{id:'a:0',record_id:'a',verified:true,fact:'A programme includes proposed energy and vehicle projects.'},{id:'a:1',record_id:'a',verified:true,fact:'The provincial government launched the programme.'},{id:'b:0',record_id:'b',verified:true,fact:'A separate regional funding meeting took place.'}];
const destination=(id,type='EDITORIAL_PUBLICATION')=>({...verified(id,evidence),id,name:id,destination_class:type,category:'news',evidence:{ids:['a:0','b:0']},relationship:{reason:'Coverage of energy and industry'}});
function providers(requests=[],response){return createOpenAiPreparationProviders({openai:{chat:{completions:{create:async request=>{requests.push(request);const payload=JSON.parse(request.messages[1].content);const finding='The programme shows a shift from isolated proposals to a combined energy-and-vehicle agenda.';return {choices:[{message:{content:JSON.stringify(response??{subject:'Discovery for '+payload.destination.name,body:`I’m Sean Walker, working on EMRADAR.\n\nOur scan identified the combined programme. What stood out was the connection between energy and vehicle plans. ${finding}\n\nWe are developing an article on what these plans would require to become operating projects. They remain proposals.\n\nWould a research contribution examining these plans interest you? If useful, I can send a concise draft with sources for review.`,analytical_finding:finding,limitations:'They remain proposals.',story_evidence_ids:payload.evidence.map(e=>e.id)})}}]};}}},images:{generate:async()=>{throw Error('NO_IMAGE_GENERATION');}}}});}
function memory(initial){let version=initial?1:null,value=initial;const adapter={read:async()=>value?{version,value:structuredClone(value)}:null,compareAndSwap:async(_id,v,next)=>{if(v!==version)return false;version=(version??0)+1;value=structuredClone(next);return true;}};return new CampaignStore(adapter);}

test('verbatim Gmail outreach is pinned by an independent literal SHA-256',()=>{
 const file=readFileSync(new URL('../vendor/emradar-v3/verification/semiconductor-for-you-outreach-v1.txt',import.meta.url),'utf8');
 assert.equal(file,originalOutreach);assert.equal(createHash('sha256').update(file).digest('hex'),'2b9b48434d441749f39e8489123ccfa628687f324ae034c1e9c67be0f3beb541');
 assert.equal(EDITORIAL_REFERENCE.message_id,'1a0f640622c1fefe');
});

test('publication and information-channel pitches receive the exact original through the same writer',async()=>{
 const requests=[],writer=providers(requests);
 for(const type of ['EDITORIAL_PUBLICATION','INFORMATION_CHANNEL']){
  const asset=await writer.write({campaignId:'campaign',destination:destination(type,type),document:{evidence}});
  assert.equal(asset.correspondence_type,'EDITORIAL_OUTREACH');assert.deepEqual(asset.editorial_reference,EDITORIAL_REFERENCE);
  assert.equal(asset.story_record_id,'a');assert.deepEqual(asset.evidence_ids,['a:0','a:1']);
 }
 assert.equal(requests.length,2);assert(requests.every(request=>request.messages[0].content.includes(originalOutreach)));
 assert(requests.every(request=>JSON.parse(request.messages[1].content).channel==='EDITORIAL_OUTREACH'));
});

test('unrelated formation IDs cannot be combined into a pitch; source-enquiry route cannot become a fallback pitch',async()=>{
 const bad={subject:'Combined story',body:'Would a research contribution interest you?',limitations:'Uncertain.',story_evidence_ids:['a:0','b:0']};
 await assert.rejects(providers([],bad).write({campaignId:'campaign',destination:destination('journal'),document:{evidence}}),/UNSUPPORTED_EDITORIAL_CONNECTION/);
 await assert.rejects(providers([],{subject:'Bypass',body:'Would you accept an article?'}).write({campaignId:'campaign',destination:{id:'source',category:'Government',evidence:{ids:['a:0']}},document:{evidence}}),/V3_VERIFIED_RECIPIENT_REQUIRED/);
});

test('initial production preparation saves reference-backed drafts without external distribution',async()=>{
 const store=memory(null),writer=providers();let discovered=0;
 const prepare=new CampaignPreparation({store,discover:async()=>{discovered++;return [destination('journal'),destination('podcast','INFORMATION_CHANNEL')];},write:writer.write,renderVisual:async()=>{throw Error('NO_IMAGES');}});
 // Seed selected destinations to isolate the affected writing route; scan
 // identity and publication verification still pass through CampaignStore.
 const scan={snapshot_date:'2026-10-10',artifact_sha256:'a'.repeat(64),live_artifact_sha256:'a'.repeat(64),archive_artifact_sha256:'a'.repeat(64),publication_verified:true};
 const id=await store.start(scan);await store.select(id,[destination('journal'),destination('podcast','INFORMATION_CHANNEL')]);
 await prepare.prepare({scan,document:{evidence}});
 const state=(await store.adapter.read(id)).value;
 assert.equal(state.phase,'PUBLICATION_REVIEW');assert.equal(discovered,0);assert.deepEqual(state.decisions,{});assert.deepEqual(state.deliveries,{});
 assert(Object.values(state.assets).every(entry=>entry.asset.editorial_reference.sha256===EDITORIAL_REFERENCE.sha256));
});

test('refresh regenerates only undecided pitches, preserves identifiers, X, decisions and old versions, and resumes without repeats',async()=>{
 const destinations=[destination('pending','INFORMATION_CHANNEL'),destination('approved'),destination('rejected')];
 const assets=Object.fromEntries(destinations.map(d=>[d.id,{fingerprint:'old-'+d.id,asset:{campaign_id:'campaign',destination_id:d.id,kind:'EMAIL',body:'Legacy',subject:'Old',to:d.contact.email,contact_status:'VERIFIED',delivery_eligible:true}}]));
 assets.x={asset:{kind:'X',body:'Keep X'},fingerprint:'keep-x'};
 const state={phase:'PUBLICATION_REVIEW',scan:{source_key:'keep-source'},destinations,assets,decisions:{approved:{decision:'APPROVE'},rejected:{decision:'REJECT'}},deliveries:{},preparation_input:{document:{evidence}},events:[]};
 const store=memory(state),requests=[],writer=providers(requests);
 const run=()=>refreshUnreviewedEditorialDrafts({store,write:writer.write,campaignId:'campaign'});
 assert.equal((await run()).rewritten,1);assert.equal((await run()).rewritten,0);assert.equal(requests.length,1);
 const saved=(await store.adapter.read('campaign')).value;
 assert.deepEqual(saved.decisions,state.decisions);assert.deepEqual(saved.assets.x,state.assets.x);assert.deepEqual(saved.assets.approved,state.assets.approved);assert.deepEqual(saved.assets.rejected,state.assets.rejected);assert.deepEqual(saved.preparation_input,state.preparation_input);assert.deepEqual(saved.deliveries,{});
 assert.equal(saved.assets.pending.asset.destination_id,'pending');assert.equal(saved.editorial_versions.pending[0].fingerprint,'old-pending');assert.equal(saved.phase,'PUBLICATION_REVIEW');
});

test('an uncertainty field cannot hide a caveat missing from the actual email',async()=>{
 await assert.rejects(providers([],{subject:'Pitch',body:'Would an article interest you?',limitations:'The plans are not completed projects.',story_evidence_ids:['a:0']}).write({campaignId:'campaign',destination:destination('journal'),document:{evidence}}),/EDITORIAL_UNCERTAINTY_REQUIRED/);
});

test('the existing alternatives route uses the same reference-backed provider',async()=>{
 const {prepareEditorialAlternatives}=await import('../vendor/emradar-v3/src/editorial-alternatives.js');
 const d=destination('journal'),store=memory({phase:'PUBLICATION_REVIEW',destinations:[d],assets:{journal:{fingerprint:'old',asset:{kind:'EMAIL',correspondence_type:'EDITORIAL_OUTREACH',body:'Old'}}},decisions:{},deliveries:{},events:[],preparation_input:{document:{evidence}}});
 const requests=[],writer=providers(requests);
 await prepareEditorialAlternatives({store,write:writer.write,campaignId:'campaign',requestId:'test-only',angles:['First editorial angle','Second editorial angle']});
 const state=(await store.adapter.read('campaign')).value;
 assert.equal(requests.length,2);assert(state.editorial_rewrite.variants.every(v=>v.asset.editorial_reference.sha256===EDITORIAL_REFERENCE.sha256));
});

test('persisted-directory draft extension uses the production OpenAI writer and retains saved X',async()=>{
 const {createOpenAiPreparationReviewService}=await import('../vendor/emradar-v3/src/preparation-review-service.js');
 const {sha256}=await import('../vendor/emradar-v3/src/contracts.js');
 let version=1,state={id:'campaign',phase:'PUBLICATION_REVIEW',assets:{x:{asset:{kind:'X',body:'Keep X'},fingerprint:'saved-x'}},destinations:[{id:'x'}],decisions:{x:{decision:'APPROVE'}},deliveries:{},events:[],preparation_input:{document:{evidence}}};
 const candidate={...destination('journal'),active:true,verification:{...destination('journal').verification,status:'VERIFIED',evidence_ids:['a:0'],scan_evidence_digest:sha256(JSON.stringify(evidence.map(e=>[e.id,e.fact,e.source_url])))}};
 const pool={query:async(sql,args=[])=>{
  if(sql.startsWith('CREATE '))return {rows:[]};
  if(sql.startsWith('SELECT record'))return {rows:[{record:candidate}]};
  if(sql.startsWith('SELECT version'))return {rows:[{version,payload:structuredClone(state)}]};
  if(sql.startsWith('UPDATE v3_campaign_state')){if(args[1]!==version)return {rowCount:0};state=JSON.parse(args[2]);version++;return {rowCount:1};}
  throw Error('UNEXPECTED_SQL');
 }};
 const requests=[];
 const openai={chat:{completions:{create:async request=>{requests.push(request);const analytical_finding='The programme shows a shift from isolated proposals to a combined energy-and-vehicle agenda.';return {choices:[{message:{content:JSON.stringify({subject:'Article idea',body:`I’m Sean Walker, working on EMRADAR.\n\nOur scan identified the combined programme. ${analytical_finding}\n\nWe are developing an article on the energy and vehicle plans. These are proposals.\n\nWould a research contribution interest you? If useful, I can send a concise draft with sources for review.`,analytical_finding,limitations:'These are proposals.',story_evidence_ids:['a:0','a:1']})}}]};}}},images:{generate:async()=>{throw Error('NO_IMAGES');}}};
 const service=await createOpenAiPreparationReviewService({pool,reviewOrigin:'https://review.example.org',notify:async()=>{throw Error('NO_EMAILS');},reviewedLinks:[],openai});
 assert.equal((await service.resumeEditorialDrafts('campaign')).editorial_drafts,1);
 assert.equal(state.assets.journal.asset.editorial_reference.sha256,EDITORIAL_REFERENCE.sha256);assert.equal(state.assets.x.fingerprint,'saved-x');assert.equal(state.decisions.x.decision,'APPROVE');assert(requests[0].messages[0].content.includes(originalOutreach));
});
